// 英文對話練習：使用 Google Gemini API（免費額度）進行對話與文法糾正。

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const GREETING = "Hi there! I'm your English practice partner. How's your day going?";

const $ = (id) => document.getElementById(id);
const chat = $('chat');
const form = $('form');
const input = $('input');
const sendBtn = $('sendBtn');

// 對話紀錄，使用 Gemini 的 contents 格式：{ role: 'user' | 'model', parts: [{ text }] }
let history = [];

const settings = {
  get apiKey() { return load('apiKey', ''); },
  get model() { return load('model', DEFAULT_MODEL) || DEFAULT_MODEL; },
  get topic() { return load('topic', ''); },
  get speak() { return load('speak', 'false') === 'true'; },
};

function load(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 無痕模式等情況下忽略 */ }
}

function systemPrompt() {
  const topic = settings.topic.trim();
  return [
    'You are a friendly English conversation partner for a Taiwanese learner.',
    topic ? `The conversation topic is: ${topic}.` : 'Chat about everyday topics.',
    `You opened the conversation by saying: "${GREETING}"`,
    'For every message from the learner:',
    '1. Check the grammar, word choice and spelling of the learner\'s latest message.',
    '   Ignore missing final punctuation and capitalization of the first letter.',
    '2. If there are mistakes, set "hasErrors" to true, put the fully corrected sentence in "corrected",',
    '   and explain each mistake briefly in Traditional Chinese (繁體中文) in "explanation".',
    '   If there are no mistakes, set "hasErrors" to false, "corrected" to an empty string,',
    '   and optionally give a short compliment or a more natural alternative in Traditional Chinese in "explanation".',
    '3. In "reply", continue the conversation naturally in simple English (1-3 sentences),',
    '   and usually end with a question to keep the learner talking.',
  ].join('\n');
}

const responseSchema = {
  type: 'OBJECT',
  properties: {
    hasErrors: { type: 'BOOLEAN' },
    corrected: { type: 'STRING' },
    explanation: { type: 'STRING' },
    reply: { type: 'STRING' },
  },
  required: ['hasErrors', 'corrected', 'explanation', 'reply'],
};

async function callGemini(contents) {
  const res = await fetch(`${API_BASE}${encodeURIComponent(settings.model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': settings.apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `HTTP ${res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  if (!text) throw new Error('模型沒有回傳內容，請再試一次。');
  return JSON.parse(text);
}

function addMessage(text, cls) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function addCorrection(result) {
  if (!result.hasErrors && !result.explanation) return;
  const div = document.createElement('div');
  div.className = result.hasErrors ? 'correction' : 'correction ok';

  const head = document.createElement('div');
  if (result.hasErrors) {
    head.textContent = '✏️ 建議改成：';
    const fixed = document.createElement('span');
    fixed.className = 'fixed';
    fixed.textContent = result.corrected;
    head.appendChild(fixed);
  } else {
    head.textContent = '✅ 文法正確！';
  }
  div.appendChild(head);

  if (result.explanation) {
    const why = document.createElement('div');
    why.className = 'why';
    why.textContent = result.explanation;
    div.appendChild(why);
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function speak(text) {
  if (!settings.speak || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function setBusy(busy) {
  input.disabled = busy;
  sendBtn.disabled = busy;
  if (!busy) input.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  if (!settings.apiKey) {
    $('settings').hidden = false;
    addMessage('請先在「設定」中填入 Google Gemini API Key。', 'error');
    return;
  }

  input.value = '';
  addMessage(text, 'user');
  const contents = [...history, { role: 'user', parts: [{ text }] }];
  const thinking = addMessage('…', 'bot');
  setBusy(true);

  try {
    const result = await callGemini(contents);
    thinking.remove();
    addCorrection(result);
    addMessage(result.reply, 'bot');
    speak(result.reply);
    // 只有成功時才寫入紀錄；模型回合存完整 JSON，讓它保持一致的輸出格式
    history = [...contents, { role: 'model', parts: [{ text: JSON.stringify(result) }] }];
  } catch (err) {
    thinking.remove();
    addMessage(`發生錯誤：${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
});

$('settingsBtn').addEventListener('click', () => {
  $('settings').hidden = !$('settings').hidden;
});

$('saveBtn').addEventListener('click', () => {
  save('apiKey', $('apiKey').value.trim());
  save('model', $('model').value.trim() || DEFAULT_MODEL);
  save('topic', $('topic').value.trim());
  save('speak', String($('speak').checked));
  $('settings').hidden = true;
  input.focus();
});

$('resetBtn').addEventListener('click', () => {
  history = [];
  chat.innerHTML = '';
  greet();
});

function greet() {
  addMessage(GREETING, 'bot');
  // Gemini 要求對話從 user 回合開始，所以開場白不放進 history，改寫在 system prompt 裡
  history = [];
}

// 初始化
$('apiKey').value = settings.apiKey;
$('model').value = settings.model;
$('topic').value = settings.topic;
$('speak').checked = settings.speak;
if (!settings.apiKey) $('settings').hidden = false;
greet();
