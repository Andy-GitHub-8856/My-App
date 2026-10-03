// Google Gemini API（REST + SSE 串流，瀏覽器直接呼叫）

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// effort → 思考預算（tokens）；-1 為模型自行決定
const BUDGET = { medium: 4096, high: -1, xhigh: 24576 };

let thinkingSupported = true;

function friendlyError(status, body) {
  const msg = body?.error?.message || '';
  const reason = body?.error?.status || '';
  if (/API_KEY_INVALID|API key not valid/i.test(msg) || status === 401) return 'Google API Key 無效，請到「設定」重新輸入。';
  if (status === 403) return `此 API Key 沒有權限（${reason || 403}）。請確認已在 Google AI Studio 啟用 Gemini API。`;
  if (status === 404) return `找不到模型，請到「設定」確認模型名稱是否正確。（${msg}）`;
  if (status === 429) return '請求太頻繁或免費額度已用完（429），請稍候再試，或改用 Flash 模型。';
  if (status >= 500) return `Google 伺服器忙碌（${status}），請稍後再試。`;
  return `API 錯誤（${status}）：${msg || reason}`;
}

const toContents = (messages) => messages.map((m) => ({
  role: m.role === 'assistant' ? 'model' : 'user',
  parts: [{ text: m.role === 'assistant' ? (m.text ?? '') : (typeof m.content === 'string' ? m.content : m.text ?? '') }],
}));

export async function runGemini({ settings, system, messages, onText, onThinking, signal, maxTokens }) {
  const key = settings.googleKey;
  if (!key) throw new Error('尚未設定 Google API Key，請先到右上角「設定」輸入。');
  const model = settings.googleModel.trim();

  const attempt = async (withThinking) => {
    const generationConfig = { maxOutputTokens: maxTokens, temperature: 0.8 };
    if (withThinking) generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: BUDGET[settings.effort] ?? -1 };
    let res;
    try {
      res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: toContents(messages), generationConfig }),
      });
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error('已停止生成。');
      throw new Error('無法連線到 Google Gemini API，請檢查網路連線。');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const err = new Error(friendlyError(res.status, body));
      err.status = res.status; err.raw = body?.error?.message || '';
      throw err;
    }
    return res;
  };

  let res;
  try {
    res = await attempt(thinkingSupported);
  } catch (e) {
    // 不支援思考設定的模型：關閉後重試一次
    if (thinkingSupported && e.status === 400 && /think/i.test(e.raw)) {
      thinkingSupported = false;
      res = await attempt(false);
    } else throw e;
  }

  let text = '', finish = '', blocked = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const json = line.slice(5).trim();
    if (!json) return;
    let chunk;
    try { chunk = JSON.parse(json); } catch { return; }
    if (chunk.promptFeedback?.blockReason) blocked = chunk.promptFeedback.blockReason;
    const cand = chunk.candidates?.[0];
    for (const p of cand?.content?.parts || []) {
      if (!p.text) continue;
      if (p.thought) onThinking?.(p.text);
      else { text += p.text; onText?.(p.text); }
    }
    if (cand?.finishReason) finish = cand.finishReason;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach(handle);
    }
    handle(buf);
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('已停止生成。');
    throw new Error('串流中斷，請重試。');
  }

  if (blocked || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(finish)) {
    throw new Error('模型基於安全政策婉拒了這次請求，請調整提問內容後再試。');
  }
  if (!text && finish !== 'MAX_TOKENS') throw new Error('模型沒有回傳內容，請重試。');
  return { text, content: null, stopReason: finish === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn' };
}
