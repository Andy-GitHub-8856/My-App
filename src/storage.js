// localStorage 包裝（無法使用時安靜失敗）

const KEY_SETTINGS = 'tianji.settings.v1';
const KEY_RECORDS = 'tianji.records.v1';

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const DEFAULT_SETTINGS = {
  provider: 'google', googleKey: '', googleModel: 'gemini-2.5-pro',
  claudeKey: '', claudeModel: 'claude-opus-5-5', rememberKey: true, effort: 'high',
};

export function loadSettings() {
  const { apiKey, model, ...saved } = read(KEY_SETTINGS, {});
  // 舊版只有 Claude：apiKey / model 轉為 claudeKey / claudeModel
  if (apiKey && !saved.claudeKey) saved.claudeKey = apiKey;
  if (model && !saved.claudeModel) saved.claudeModel = model;
  return { ...DEFAULT_SETTINGS, ...saved };
}
export function saveSettings(s) {
  write(KEY_SETTINGS, s.rememberKey ? s : { ...s, googleKey: '', claudeKey: '' });
}

export const loadRecords = () => read(KEY_RECORDS, []);
export function saveRecord(rec) {
  const list = loadRecords().filter((r) => r.id !== rec.id);
  list.unshift(rec);
  return write(KEY_RECORDS, list);
}
export function deleteRecord(id) {
  write(KEY_RECORDS, loadRecords().filter((r) => r.id !== id));
}
export function importRecords(arr) {
  const map = new Map(loadRecords().map((r) => [r.id, r]));
  for (const r of arr) if (r?.id && r?.chart) map.set(r.id, r);
  return write(KEY_RECORDS, [...map.values()]);
}
