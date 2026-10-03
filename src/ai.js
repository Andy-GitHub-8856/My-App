// Claude API：解盤章節與追問

import Anthropic from '@anthropic-ai/sdk';
import { runGemini } from './gemini.js';

export const PROVIDERS = {
  google: {
    label: 'Google Gemini', keyField: 'googleKey', modelField: 'googleModel', keyPlaceholder: 'AIza…',
    keyHint: '到 aistudio.google.com 按「Get API key」免費申請。Key 只會存在你的瀏覽器，並且只直接傳送到 Google。',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro（最深入，預設）' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（較快、免費額度較多）' },
    ],
  },
  claude: {
    label: 'Anthropic Claude', keyField: 'claudeKey', modelField: 'claudeModel', keyPlaceholder: 'sk-ant-…',
    keyHint: '到 console.anthropic.com 申請。Key 只會存在你的瀏覽器，並且只直接傳送到 api.anthropic.com。',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（最深入）' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（較快、較省）' },
    ],
  },
};
export const currentKey = (s) => s[PROVIDERS[s.provider].keyField];

export const SECTIONS = [
  { id: 'overview', title: '命格總論', icon: '☯', needZiwei: false,
    ask: '請撰寫「命格總論」：綜合紫微命盤與八字，點出此命最核心的格局特質、人生主軸、天賦與課題，並給一段總結判語（可仿古籍斷語，再附白話）。' },
  { id: 'soul', title: '命宮與身宮', icon: '✦', needZiwei: true,
    ask: '請詳解「命宮與身宮」：命宮主星（含廟旺利陷、四化、同宮輔佐煞曜）、三方四正的會照、身宮位置的意義，深入分析性格、外在形象、內在心性、優勢與盲點。' },
  { id: 'palaces1', title: '十二宮詳解（上）', icon: '✧', needZiwei: true,
    ask: '請逐宮詳解：兄弟宮、夫妻宮、子女宮、財帛宮、疾厄宮。每宮都要寫出：宮內星曜組合與亮度、對宮與三方的影響、具體論斷（人際/感情模式/子女緣/理財模式/體質需注意之處），並給實際建議。疾厄宮只談體質傾向與保養，不做醫療診斷。' },
  { id: 'palaces2', title: '十二宮詳解（下）', icon: '✧', needZiwei: true,
    ask: '請逐宮詳解：遷移宮、僕役（交友）宮、官祿宮、田宅宮、福德宮、父母宮。每宮都要寫出星曜組合與亮度、對宮與三方的影響、具體論斷（外出發展、人脈、適合的職業類型與工作風格、置產與家庭、精神福分與興趣、與長輩上司關係），並給實際建議。' },
  { id: 'mutagen', title: '四化與格局', icon: '❂', needZiwei: true,
    ask: '請分析「生年四化與格局」：化祿、化權、化科、化忌各落何宮、代表的人生重點與因果；檢查命盤是否構成知名格局（如紫府同宮、機月同梁、殺破狼、府相朝垣、日月並明、火貪、鈴貪、羊陀夾忌等），說明成格條件是否完整與吉凶。' },
  { id: 'timing', title: '大限與流年', icon: '⌛', needZiwei: true,
    ask: '請分析「運勢時間軸」：先概述一生各大限的起伏（每個大限一兩句），再深入目前大限（大限命宮、大限四化引動哪些宮位），最後詳論今年流年（流年命宮、流年四化、小限）與未來兩年趨勢，分事業、財運、感情、健康給出具體提醒與宜忌。' },
  { id: 'bazi', title: '八字命局', icon: '☰', needZiwei: false,
    ask: '請詳解「八字命局」：日主特性、得令得地得勢分析、身強身弱判定（可修正程式初判並說明理由）、格局（正格或特殊格局）、調候需求、喜用神與忌神、十神組合所呈現的性格與六親，以及五行缺失或過旺的影響與補救方式。' },
  { id: 'dayun', title: '八字大運流年', icon: '☷', needZiwei: false,
    ask: '請詳解「八字大運與流年」：逐一論述每步大運干支與命局的生剋合沖、喜忌，標出人生的高峰期與需要謹慎的階段；再詳論目前大運與今年流年（干支與原局、大運的互動，如沖合刑害），給出具體建議。' },
  { id: 'chenggu', title: '稱骨論斷', icon: '⚖', needZiwei: false,
    ask: '請撰寫「稱骨論斷」：說明骨重的意義與來源（袁天罡稱骨法），逐句白話解釋稱骨歌，並以現代觀點詮釋（強調骨重輕重不等於人生成敗），再與八字、紫微的結論互相印證。若時辰不詳，說明此結果不完整。' },
  { id: 'advice', title: '綜合建議與開運', icon: '❀', needZiwei: false,
    ask: '請撰寫「綜合建議與開運指南」：分別就個性修養、事業方向（列出適合的行業與職位類型）、財運與理財策略、感情與婚姻、健康保養、人際貴人給出具體可行建議；再依喜用神提供開運顏色、方位、數字、飾品材質、適合居住或發展的方位；最後以一段溫暖有力量的結語收尾。' },
];

const RULES = `你是一位融會紫微斗數（三合派、以生年四化為主）與子平八字的資深命理老師，文筆典雅而清晰。

撰寫規則：
1. 只能依據下方【命盤資料】論斷。命盤由程式精確排出，不得更改、增添或臆測任何星曜、宮位、干支。若資料不足就直說。
2. 語氣：專業命理師口吻 + 白話解釋。每個論點先寫命理依據（例如「命宮武曲化權、天府同度，皆廟旺」），再用白話說明它在生活中的意義與具體表現。
3. 越詳細越好，但要有條理：使用 Markdown 的 ### 小標題、**粗體**重點、條列清單；適度引用古籍口訣（如《紫微斗數全書》、《滴天髓》、《窮通寶鑑》），並附白話翻譯。
4. 以繁體中文撰寫。正向而誠實：吉處說明如何發揮，凶處說明如何趨吉避凶，不恐嚇、不宿命。
5. 不做醫療診斷、投資標的建議或法律判斷；健康只談體質傾向與保養，財務只談理財性格與方向。
6. 直接從內容開始，不要寒暄、不要重複章節名稱作為第一行標題。`;

let fallbackSupported = true;

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API Key 無效或已過期，請到「設定」重新輸入。';
  if (e instanceof Anthropic.PermissionDeniedError) return '此 API Key 沒有使用該模型的權限。';
  if (e instanceof Anthropic.RateLimitError) return '請求太頻繁或額度已用完（429），請稍候再試。';
  if (e instanceof Anthropic.APIConnectionError) return '無法連線到 Claude API，請檢查網路連線。';
  if (e instanceof Anthropic.APIError) return `API 錯誤（${e.status ?? '未知'}）：${e.message}`;
  if (e?.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) return '已停止生成。';
  return `發生錯誤：${e?.message || e}`;
}

export function systemBlocks(chartText) {
  return [
    { type: 'text', text: RULES },
    { type: 'text', text: `【命盤資料】\n${chartText}`, cache_control: { type: 'ephemeral' } },
  ];
}

// messages: 對話歷史（append-only）；onText/onThinking：串流回呼
// 回傳 { content, text, stopReason } ；失敗時丟出含中文訊息的 Error
export function runAI(opts) {
  const { settings, chartText } = opts;
  const o = { maxTokens: 32000, ...opts };
  if (settings.provider === 'google') return runGemini({ ...o, system: `${RULES}\n\n【命盤資料】\n${chartText}` });
  return runClaude(o);
}

// 對話歷史中的助理訊息會同時存 content（Claude 區塊）與 text（純文字），以便切換供應商
const toClaudeMessages = (messages) => messages.map((m) => ({
  role: m.role,
  content: m.role === 'assistant' && !m.content ? m.text : m.content,
}));

async function runClaude({ settings, chartText, messages, onText, onThinking, signal, maxTokens }) {
  if (!settings.claudeKey) throw new Error('尚未設定 Claude API Key，請先到右上角「設定」輸入。');
  const client = new Anthropic({ apiKey: settings.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

  const attempt = async (useFallback) => {
    const params = {
      model: settings.claudeModel,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: settings.effort },
      system: systemBlocks(chartText),
      messages: toClaudeMessages(messages),
    };
    if (useFallback) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    const stream = client.beta.messages.stream(params, { signal });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') onText?.(ev.delta.text);
        else if (ev.delta.type === 'thinking_delta') onThinking?.(ev.delta.thinking);
      }
    }
    return stream.finalMessage();
  };

  let msg;
  try {
    try {
      msg = await attempt(fallbackSupported);
    } catch (e) {
      // 帳號或區域不支援備援參數時，關閉後重試一次
      if (fallbackSupported && e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
        fallbackSupported = false;
        msg = await attempt(false);
      } else throw e;
    }
  } catch (e) {
    throw new Error(friendlyError(e));
  }

  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (msg.stop_reason === 'refusal') {
    throw new Error('模型基於安全政策婉拒了這次請求，請調整提問內容後再試。');
  }
  return { content: msg.content, text, stopReason: msg.stop_reason };
}
