import { CITIES, findCity, isDst, correctTime, fmtTime } from './solartime.js';
import { Lunar } from 'lunar-javascript';
import { buildChart, chartToPrompt } from './chart.js';
import { renderZiwei, bindZiwei, renderBazi, renderChenggu } from './render.js';
import { renderMarkdown } from './markdown.js';
import { PROVIDERS, SECTIONS, runAI, currentKey } from './ai.js';
import * as store from './storage.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let settings = store.loadSettings();
const state = { chart: null, chartText: '', readings: {}, chat: { messages: [], display: [] }, recordId: null, busy: false, abort: null };

/* ---------- 星空 ---------- */
function starfield() {
  const cv = $('#stars'), ctx = cv.getContext('2d');
  let stars = [], meteors = [], w, h;
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = cv.width = innerWidth * dpr; h = cv.height = innerHeight * dpr;
    const n = Math.round((innerWidth * innerHeight) / 3500);
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.3 + .25) * dpr,
      p: Math.random() * Math.PI * 2, s: Math.random() * .02 + .004, gold: Math.random() < .18,
    }));
  };
  resize(); addEventListener('resize', resize);
  const frame = () => {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.p += s.s;
      const a = .35 + Math.sin(s.p) * .35 + .3;
      ctx.fillStyle = s.gold ? `rgba(243,217,139,${a})` : `rgba(220,215,255,${a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
    }
    if (Math.random() < .004) meteors.push({ x: Math.random() * w, y: Math.random() * h * .4, v: 9 + Math.random() * 7, life: 1 });
    meteors = meteors.filter((m) => m.life > 0);
    for (const m of meteors) {
      const g = ctx.createLinearGradient(m.x, m.y, m.x - 90, m.y - 45);
      g.addColorStop(0, `rgba(255,240,200,${m.life})`); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - 90, m.y - 45); ctx.stroke();
      m.x += m.v; m.y += m.v / 2; m.life -= .02;
    }
    requestAnimationFrame(frame);
  };
  if (reduceMotion) { frame(); return; }
  requestAnimationFrame(frame);
}

/* ---------- 八卦羅盤 ---------- */
function compass() {
  const svg = $('#compass');
  const polar = (r, deg) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
  const ring = (r) => `<circle class="ring" r="${r}"/>`;
  const ticks = (r1, r2, n) => Array.from({ length: n }, (_, i) => {
    const [x1, y1] = polar(r1, (360 / n) * i), [x2, y2] = polar(r2, (360 / n) * i);
    return `<line class="tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join('');
  const label = (r, deg, t, size) => {
    const [x, y] = polar(r, deg);
    return `<text x="${x}" y="${y}" font-size="${size}" transform="rotate(${deg} ${x} ${y})">${t}</text>`;
  };
  const XIU = '角亢氐房心尾箕斗牛女虛危室壁奎婁胃昴畢觜參井鬼柳星張翼軫';
  const ZHI = '午未申酉戌亥子丑寅卯辰巳'; // 上南下北
  // 後天八卦（由上方「南」順時針）；位元由下爻至上爻
  const GUA = [['離', '101'], ['坤', '000'], ['兌', '110'], ['乾', '111'], ['坎', '010'], ['艮', '001'], ['震', '100'], ['巽', '011']];
  const trigram = (deg, bits) => {
    let out = '';
    [...bits].forEach((b, i) => {
      const r = 64 + (2 - i) * 7; // 上爻在外
      const half = 13;
      const [cx, cy] = polar(r, deg);
      const tr = `rotate(${deg} ${cx} ${cy})`;
      if (b === '1') out += `<rect x="${cx - half}" y="${cy - 2}" width="${half * 2}" height="4" fill="#d4af37" transform="${tr}"/>`;
      else out += `<rect x="${cx - half}" y="${cy - 2}" width="${half - 3}" height="4" fill="#d4af37" transform="${tr}"/><rect x="${cx + 3}" y="${cy - 2}" width="${half - 3}" height="4" fill="#d4af37" transform="${tr}"/>`;
    });
    return out;
  };
  svg.innerHTML = `
    <defs><radialGradient id="glow"><stop offset="0" stop-color="rgba(155,107,255,.35)"/><stop offset="1" stop-color="rgba(155,107,255,0)"/></radialGradient></defs>
    <circle r="195" fill="url(#glow)"/>
    <g class="r1">${ring(178)}${ring(148)}${ticks(148, 178, 28)}${[...XIU].map((c, i) => label(163, (360 / 28) * (i + .5), c, 12)).join('')}</g>
    <g class="r2">${ring(135)}${ring(104)}${ticks(104, 135, 12)}${[...ZHI].map((c, i) => label(119.5, 30 * i, c, 18)).join('')}</g>
    <g class="r3">${ring(92)}${ring(52)}${GUA.map(([n, b], i) => trigram(45 * i, b) + label(98 - 41, 45 * i, n, 11)).join('')}</g>
    <g class="core">
      <circle r="38" fill="#0d0b26" stroke="#d4af37"/>
      <path d="M0,-36 A36,36 0 0,1 0,36 A18,18 0 0,1 0,0 A18,18 0 0,0 0,-36 Z" fill="#d4af37"/>
      <circle cy="-18" r="5" fill="#d4af37"/><circle cy="18" r="5" fill="#0d0b26"/>
    </g>`;
}
const spinFast = (ms = 1600) => {
  const c = $('#compass'); c.classList.add('fast'); setTimeout(() => c.classList.remove('fast'), ms);
};

/* ---------- 提示 ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ---------- 表單 ---------- */
const form = $('#birth-form');
function initForm() {
  const sel = $('#place');
  sel.innerHTML = CITIES.map((g) => `<optgroup label="${g.group}">${g.items.map((c) => `<option>${c.name}</option>`).join('')}</optgroup>`).join('')
    + '<option value="__custom">其他（自訂經度／時區）</option>';
  sel.value = '台北';
  form.addEventListener('input', onFormChange);
  form.addEventListener('change', onFormChange);
  form.addEventListener('submit', onCast);
  onFormChange();
}

function readForm() {
  const f = new FormData(form);
  const num = (k) => (f.get(k) === '' || f.get(k) == null ? NaN : Number(f.get(k)));
  const place = f.get('place');
  const city = findCity(place);
  return {
    name: String(f.get('name') || '').trim(), gender: f.get('gender'), calendar: f.get('calendar'),
    y: num('y'), m: num('m'), d: num('d'), leap: f.get('leap') === 'on',
    h: num('h'), mi: Number.isNaN(num('mi')) ? 0 : num('mi'), hourUnknown: f.get('hourUnknown') === 'on',
    place: city ? city.name : `自訂（經度 ${f.get('lon')}，UTC${num('tz') >= 0 ? '+' : ''}${f.get('tz')}）`,
    lon: city ? city.lon : num('lon'), tz: city ? city.tz : num('tz'), dstRegion: city?.dst || '',
    trueSolar: f.get('trueSolar') === 'on', dst: f.get('dst') === 'on', ziMode: f.get('ziMode'),
    focus: String(f.get('focus') || '').trim(),
  };
}

function solarOf(i) {
  if (i.calendar !== 'lunar') return [i.y, i.m, i.d];
  try { const s = Lunar.fromYmd(i.y, i.leap ? -i.m : i.m, i.d).getSolar(); return [s.getYear(), s.getMonth(), s.getDay()]; } catch { return null; }
}

let lastDstKey = '';
function onFormChange(e) {
  const i = readForm();
  form.classList.toggle('is-lunar', i.calendar === 'lunar');
  form.classList.toggle('is-custom', $('#place').value === '__custom');
  $('input[name=h]', form).disabled = $('input[name=mi]', form).disabled = i.hourUnknown;

  const valid = [i.y, i.m, i.d].every(Number.isFinite);
  const sol = valid ? solarOf(i) : null;
  // 夏令時自動偵測（日期或地點改變時才覆寫勾選）
  const key = sol ? `${sol.join('-')}|${i.dstRegion}` : '';
  if (sol && key !== lastDstKey && e?.target?.name !== 'dst') {
    lastDstKey = key;
    $('input[name=dst]', form).checked = isDst(i.dstRegion, ...sol);
  }
  const p = $('#time-preview');
  if (!sol || i.hourUnknown || !Number.isFinite(i.h) || !Number.isFinite(i.lon) || !Number.isFinite(i.tz)) { p.textContent = ''; return; }
  const dstNow = $('input[name=dst]', form).checked;
  const ct = correctTime({ y: sol[0], m: sol[1], d: sol[2], h: i.h, mi: i.mi }, { lon: i.lon, tz: i.tz, dst: dstNow, trueSolar: i.trueSolar });
  const autoDst = isDst(i.dstRegion, ...sol);
  p.innerHTML = `校正後時間：<b class="gold">${fmtTime(ct)}</b>（夏令 ${ct.dstMin} 分、經度 ${ct.lonMin > 0 ? '+' : ''}${ct.lonMin} 分、均時差 ${ct.eotMin > 0 ? '+' : ''}${ct.eotMin} 分）`
    + (autoDst ? '<br>⚠ 此日期在當地實施夏令時間，出生證明上的時間通常比實際快 1 小時，已自動勾選。' : '');
}

function validate(i) {
  if (!i.name) return '請輸入姓名或暱稱。';
  if (![i.y, i.m, i.d].every(Number.isFinite)) return '請完整輸入出生年、月、日。';
  if (i.y < 1900 || i.y > 2100) return '出生年份需介於 1900–2100。';
  if (i.m < 1 || i.m > 12 || i.d < 1 || i.d > (i.calendar === 'lunar' ? 30 : 31)) return '月份或日期不正確。';
  if (i.calendar === 'solar') {
    const t = new Date(Date.UTC(i.y, i.m - 1, i.d));
    if (t.getUTCMonth() !== i.m - 1) return '此國曆日期不存在。';
  }
  if (!i.hourUnknown) {
    if (!Number.isFinite(i.h) || i.h < 0 || i.h > 23) return '請輸入出生時（0–23），或勾選「時辰不詳」。';
    if (i.mi < 0 || i.mi > 59) return '分鐘需介於 0–59。';
  }
  if (!Number.isFinite(i.lon) || !Number.isFinite(i.tz)) return '請輸入自訂經度與時區。';
  return '';
}

function onCast(e) {
  e.preventDefault();
  const i = readForm();
  const err = validate(i);
  $('#form-error').textContent = err;
  if (err) return;
  let chart;
  try { chart = buildChart(i); } catch (ex) { $('#form-error').textContent = ex.message; return; }
  spinFast();
  $('#btn-cast').disabled = true;
  setTimeout(() => {
    $('#btn-cast').disabled = false;
    loadChart(chart, { readings: {}, chat: { messages: [], display: [] }, id: null });
    $('#results').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }, reduceMotion ? 0 : 900);
}

/* ---------- 結果 ---------- */
function loadChart(chart, { readings, chat, id }) {
  stopGeneration();
  state.chart = chart; state.chartText = chartToPrompt(chart);
  state.readings = readings || {}; state.chat = chat || { messages: [], display: [] }; state.recordId = id;
  const i = chart.input;
  $('#r-title').textContent = `${i.name}　${i.gender === '男' ? '乾造' : '坤造'}`;
  $('#r-sub').textContent = `${i.calendar === 'lunar' ? '農曆' : '國曆'} ${i.y}/${i.m}/${i.d}${i.leap ? '（閏）' : ''} ${i.hourUnknown ? '時辰不詳' : `${i.h}:${String(i.mi).padStart(2, '0')}`} · ${i.place} · 農曆 ${chart.lunar.text} ${chart.timeName}`;
  $('#r-warn').innerHTML = chart.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  $('#panel-ziwei').innerHTML = renderZiwei(chart); bindZiwei($('#panel-ziwei'));
  $('#panel-bazi').innerHTML = renderBazi(chart);
  $('#panel-chenggu').innerHTML = renderChenggu(chart);
  renderSections(); renderChat();
  $('#results').hidden = false;
  $('#results').classList.remove('reveal'); void $('#results').offsetWidth; $('#results').classList.add('reveal');
  switchTab('ziwei');
}

function switchTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
}

/* ---------- AI 解盤 ---------- */
function renderSections() {
  const hasZiwei = !!state.chart.ziwei;
  $('#sections').innerHTML = SECTIONS.map((s) => {
    const r = state.readings[s.id];
    const disabled = s.needZiwei && !hasZiwei;
    return `<article class="sec" id="sec-${s.id}">
      <div class="sec-head"><span class="sec-icon">${s.icon}</span><h3>${s.title}</h3>
        <span class="sec-state">${disabled ? '需出生時辰' : r?.text ? '已完成' : ''}</span>
        <button class="btn" type="button" data-gen="${s.id}" ${disabled ? 'disabled' : ''}>${r?.text ? '↻ 重新生成' : '✦ 生成'}</button></div>
      <div class="sec-body md">${r?.text ? renderMarkdown(r.text) : ''}</div></article>`;
  }).join('');
  $$('[data-gen]').forEach((b) => b.addEventListener('click', () => generateSections([b.dataset.gen])));
}

function setBusy(b) {
  state.busy = b;
  $('#btn-stop').hidden = !b;
  $('#btn-all').disabled = b;
  $$('[data-gen]').forEach((x) => { x.disabled = b || (SECTIONS.find((s) => s.id === x.dataset.gen).needZiwei && !state.chart.ziwei); });
  $('#chat-form button').disabled = b;
}

function stopGeneration() { state.abort?.abort(); }

function makeStreamView(container) {
  container.innerHTML = '<div class="thinking" hidden></div><div class="out cursor"><span class="loading-orb"></span> 正在觀星推演…</div>';
  const th = $('.thinking', container), out = $('.out', container);
  let text = '', thinking = '', raf = 0;
  const paint = () => {
    raf = 0;
    if (thinking) { th.hidden = false; th.textContent = thinking.slice(-600); th.scrollTop = th.scrollHeight; }
    if (text) { out.innerHTML = renderMarkdown(text); th.hidden = true; }
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
  return {
    onText: (t) => { text += t; schedule(); },
    onThinking: (t) => { thinking += t; schedule(); },
    done: (finalText) => { cancelAnimationFrame(raf); container.innerHTML = renderMarkdown(finalText); },
    fail: (msg) => { cancelAnimationFrame(raf); container.innerHTML = (text ? renderMarkdown(text) : '') + `<p class="err">⚠ ${esc(msg)}</p>`; },
  };
}

async function generateSections(ids) {
  if (state.busy) return;
  if (!currentKey(settings)) { toast(`請先在「設定」輸入 ${PROVIDERS[settings.provider].label} API Key`); openSettings(); return; }
  setBusy(true);
  const ctrl = new AbortController(); state.abort = ctrl;
  let i = 0;
  for (const id of ids) {
    i++;
    const s = SECTIONS.find((x) => x.id === id);
    if (s.needZiwei && !state.chart.ziwei) continue;
    if (ctrl.signal.aborted) break;
    $('#reading-status').innerHTML = `<span class="loading-orb"></span> 推演第 ${i}/${ids.length} 章：${s.title}`;
    const art = $(`#sec-${id}`); art.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    $('.sec-state', art).textContent = '推演中…';
    const view = makeStreamView($('.sec-body', art));
    const focus = state.chart.input.focus ? `\n\n（命主特別關心：「${state.chart.input.focus}」，若與本章相關請多加著墨。）` : '';
    try {
      const res = await runAI({
        settings, chartText: state.chartText, signal: ctrl.signal,
        messages: [{ role: 'user', content: s.ask + focus }],
        onText: view.onText, onThinking: view.onThinking,
      });
      const text = res.text + (res.stopReason === 'max_tokens' ? '\n\n> （內容過長已截斷，可按「重新生成」。）' : '');
      state.readings[id] = { text, at: new Date().toISOString(), model: settings[PROVIDERS[settings.provider].modelField] };
      view.done(text);
      $('.sec-state', art).textContent = '已完成';
      $('[data-gen]', art).textContent = '↻ 重新生成';
      autosave();
    } catch (ex) {
      view.fail(ex.message);
      $('.sec-state', art).textContent = '失敗';
      if (ctrl.signal.aborted || /API Key|429|連線/.test(ex.message)) break;
    }
  }
  $('#reading-status').textContent = ctrl.signal.aborted ? '已停止。' : '';
  state.abort = null;
  setBusy(false);
}

/* ---------- 追問 ---------- */
function renderChat() {
  const log = $('#chat-log');
  if (!state.chat.display.length) {
    log.innerHTML = '<p class="muted">針對你的命盤自由提問，例如「我適合創業還是上班？」「明年感情運如何？」</p>';
    return;
  }
  log.innerHTML = state.chat.display.map((m) => m.role === 'user'
    ? `<div class="msg user">${esc(m.text)}</div>` : `<div class="msg ai md">${renderMarkdown(m.text)}</div>`).join('');
  log.scrollTop = log.scrollHeight;
}

async function onAsk(e) {
  e.preventDefault();
  if (state.busy) return;
  const ta = $('textarea', e.target); const q = ta.value.trim();
  if (!q) return;
  if (!currentKey(settings)) { toast(`請先在「設定」輸入 ${PROVIDERS[settings.provider].label} API Key`); openSettings(); return; }
  let content = q;
  if (!state.chat.messages.length) {
    const done = SECTIONS.filter((s) => state.readings[s.id]?.text).map((s) => `## ${s.title}\n${state.readings[s.id].text}`).join('\n\n');
    content = (done ? `以下是先前已完成的解盤內容，供你回答時參考：\n\n${done}\n\n---\n\n` : '')
      + `接下來我會針對命盤提問，請以對話方式回答，依據命盤具體說明，篇幅適中、重點清楚。\n\n我的問題：${q}`;
  }
  state.chat.messages.push({ role: 'user', content });
  state.chat.display.push({ role: 'user', text: q });
  ta.value = '';
  renderChat();
  const log = $('#chat-log');
  const bubble = document.createElement('div'); bubble.className = 'msg ai md'; log.appendChild(bubble);
  const view = makeStreamView(bubble);
  setBusy(true);
  const ctrl = new AbortController(); state.abort = ctrl;
  try {
    const res = await runAI({ settings, chartText: state.chartText, messages: state.chat.messages, signal: ctrl.signal, onText: (t) => { view.onText(t); log.scrollTop = log.scrollHeight; }, onThinking: view.onThinking, maxTokens: 16000 });
    state.chat.messages.push({ role: 'assistant', content: res.content, text: res.text });
    state.chat.display.push({ role: 'ai', text: res.text });
    view.done(res.text);
    autosave();
  } catch (ex) {
    // 失敗時移除這一輪提問，保持對話歷史一致
    state.chat.messages.pop(); state.chat.display.pop();
    view.fail(ex.message); ta.value = q;
  }
  state.abort = null;
  setBusy(false);
  log.scrollTop = log.scrollHeight;
}

/* ---------- 設定 ---------- */
let draft = null; // 設定對話框中各供應商的暫存值
function showProvider(f) {
  const p = PROVIDERS[f.provider.value];
  $('#key-label').textContent = `${p.label} API Key`;
  f.apiKey.placeholder = p.keyPlaceholder;
  f.apiKey.value = draft[p.keyField];
  f.model.value = draft[p.modelField];
  $('#key-hint').textContent = p.keyHint;
  $('#model-list').innerHTML = p.models.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
}
function stashProvider(f) {
  const p = PROVIDERS[f.provider.dataset.prev];
  draft[p.keyField] = f.apiKey.value.trim();
  draft[p.modelField] = f.model.value.trim() || p.models[0].id;
}
function openSettings() {
  const f = $('#settings-form');
  draft = { ...settings };
  f.provider.value = f.provider.dataset.prev = settings.provider;
  f.rememberKey.checked = settings.rememberKey; f.effort.value = settings.effort;
  showProvider(f);
  $('#dlg-settings').showModal();
}
function initSettings() {
  const f = $('#settings-form');
  $('#btn-settings').addEventListener('click', openSettings);
  f.provider.addEventListener('change', () => { stashProvider(f); f.provider.dataset.prev = f.provider.value; showProvider(f); });
  $('#dlg-settings').addEventListener('close', () => {
    if ($('#dlg-settings').returnValue !== 'ok') return;
    stashProvider(f);
    settings = { ...draft, provider: f.provider.value, rememberKey: f.rememberKey.checked, effort: f.effort.value };
    store.saveSettings(settings);
    toast(`設定已儲存，目前使用 ${PROVIDERS[settings.provider].label}`);
  });
}

/* ---------- 存檔 ---------- */
function currentRecord() {
  return {
    id: state.recordId || `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: state.chart.input.name, savedAt: new Date().toISOString(),
    chart: state.chart, readings: state.readings, chat: state.chat,
  };
}
function saveNow(silent) {
  if (!state.chart) return;
  const rec = currentRecord();
  state.recordId = rec.id;
  const ok = store.saveRecord(rec);
  if (!silent) toast(ok ? '命盤已儲存到此瀏覽器' : '儲存失敗（瀏覽器可能停用儲存空間）');
}
function autosave() { if (state.recordId) saveNow(true); }

function renderRecords() {
  const list = store.loadRecords();
  $('#records-list').innerHTML = list.length ? list.map((r) => {
    const i = r.chart.input;
    const n = Object.keys(r.readings || {}).length;
    return `<div class="rec"><div><b>${esc(r.name)}</b> <small>${i.gender} · ${i.calendar === 'lunar' ? '農' : '國'}曆 ${i.y}/${i.m}/${i.d} · 解盤 ${n} 章 · ${new Date(r.savedAt).toLocaleString('zh-TW')}</small></div>
      <div><button class="btn" type="button" data-load="${r.id}">開啟</button> <button class="btn ghost" type="button" data-del="${r.id}">刪除</button></div></div>`;
  }).join('') : '<p class="muted">尚無存檔。排盤後按「儲存命盤」即可保存（含 AI 解盤內容）。</p>';
  $$('[data-load]').forEach((b) => b.addEventListener('click', () => {
    const r = store.loadRecords().find((x) => x.id === b.dataset.load);
    if (!r) return;
    $('#dlg-records').close();
    fillForm(r.chart.input);
    loadChart(r.chart, { readings: r.readings, chat: r.chat, id: r.id });
    $('#results').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('確定刪除這份命盤存檔？')) return;
    store.deleteRecord(b.dataset.del);
    if (state.recordId === b.dataset.del) state.recordId = null;
    renderRecords();
  }));
}

function fillForm(i) {
  const set = (n, v) => { const el = form.elements[n]; if (el) el.value = v ?? ''; };
  set('name', i.name); set('y', i.y); set('m', i.m); set('d', i.d);
  set('h', i.hourUnknown ? '' : i.h); set('mi', i.hourUnknown ? '' : i.mi); set('focus', i.focus);
  $(`input[name=gender][value="${i.gender}"]`, form).checked = true;
  $(`input[name=calendar][value="${i.calendar}"]`, form).checked = true;
  $(`input[name=ziMode][value="${i.ziMode}"]`, form).checked = true;
  form.elements.leap.checked = !!i.leap; form.elements.hourUnknown.checked = !!i.hourUnknown;
  form.elements.trueSolar.checked = !!i.trueSolar;
  const city = findCity(i.place);
  $('#place').value = city ? city.name : '__custom';
  if (!city) { set('lon', i.lon); set('tz', i.tz); }
  onFormChange();
  form.elements.dst.checked = !!i.dst;
  lastDstKey = '__loaded';
  onFormChange({ target: { name: 'dst' } });
}

function initRecords() {
  $('#btn-records').addEventListener('click', () => { renderRecords(); $('#dlg-records').showModal(); });
  $('#btn-save').addEventListener('click', () => saveNow(false));
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.loadRecords(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `天機命譜存檔-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const arr = JSON.parse(await file.text());
      if (!Array.isArray(arr)) throw new Error();
      store.importRecords(arr); renderRecords(); toast(`已匯入 ${arr.length} 筆`);
    } catch { toast('檔案格式不正確'); }
    e.target.value = '';
  });
}

/* ---------- 列印命書 ---------- */
function printBook() {
  if (!state.chart) return;
  const c = state.chart, i = c.input;
  const readings = SECTIONS.filter((s) => state.readings[s.id]?.text)
    .map((s) => `<section><h2>${s.icon} ${s.title}</h2><div class="md">${renderMarkdown(state.readings[s.id].text)}</div></section>`).join('');
  $('#print-book').innerHTML = `
    <div class="cover"><h1>天機命譜</h1><p style="font-size:22pt;margin-top:20mm">${esc(i.name)}　${i.gender === '男' ? '乾造' : '坤造'}</p>
      <p>${i.calendar === 'lunar' ? '農曆' : '國曆'} ${i.y} 年 ${i.leap ? '閏' : ''}${i.m} 月 ${i.d} 日 ${i.hourUnknown ? '時辰不詳' : `${i.h} 時 ${i.mi} 分`}　${esc(i.place)}</p>
      <p>四柱：${c.bazi.cols.map((x) => x.gz).join('　')}</p><p>批命日期：${new Date().toLocaleDateString('zh-TW')}</p></div>
    <section style="page-break-before:auto"><h2>紫微斗數命盤</h2>${renderZiwei(c)}</section>
    <section><h2>八字命盤</h2>${renderBazi(c)}<h2>八字重量</h2>${renderChenggu(c)}</section>
    ${readings || '<section><p>（尚未生成 AI 解盤）</p></section>'}
    <p style="text-align:center;margin-top:16mm;color:#666">命理分析僅供參考與娛樂，人生掌握在自己手中。</p>`;
  window.print();
}

/* ---------- 啟動 ---------- */
function init() {
  starfield(); compass(); initForm(); initSettings(); initRecords();
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#btn-all').addEventListener('click', () => generateSections(SECTIONS.map((s) => s.id)));
  $('#btn-stop').addEventListener('click', stopGeneration);
  $('#chat-form').addEventListener('submit', onAsk);
  $('#chat-form textarea').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#chat-form').requestSubmit(); });
  $('#btn-new').addEventListener('click', () => { $('#form-card').scrollIntoView({ behavior: 'smooth' }); });
  $('#btn-print').addEventListener('click', printBook);
  if (!currentKey(settings)) setTimeout(() => toast('提示：AI 解盤需先在「設定」輸入 Google Gemini API Key'), 1500);
}
init();
