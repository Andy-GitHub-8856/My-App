'use strict';

/* ================= 設定 ================= */

const API = 'https://api.finmindtrade.com/api/v4/data';

const DEFAULT_WATCHLIST = [
  { id: '2330', name: '台積電' },
  { id: '2317', name: '鴻海' },
  { id: '2454', name: '聯發科' },
  { id: '2308', name: '台達電' },
  { id: '2382', name: '廣達' },
  { id: '3231', name: '緯創' },
  { id: '6669', name: '緯穎' },
  { id: '2357', name: '華碩' },
  { id: '3711', name: '日月光投控' },
  { id: '2303', name: '聯電' },
  { id: '3008', name: '大立光' },
  { id: '2412', name: '中華電' },
  { id: '2881', name: '富邦金' },
  { id: '2882', name: '國泰金' },
  { id: '2891', name: '中信金' },
  { id: '2886', name: '兆豐金' },
  { id: '2884', name: '玉山金' },
  { id: '1301', name: '台塑' },
  { id: '2002', name: '中鋼' },
  { id: '2603', name: '長榮' },
];

const WEIGHTS = { tech: 0.30, value: 0.25, growth: 0.25, chips: 0.20 };
const FACTOR_LABELS = { tech: '技術', value: '估值', growth: '成長', chips: '籌碼' };

const LS = {
  watch: 'tws.watchlist',
  token: 'tws.token',
  info: 'tws.stockinfo',
  cachePrefix: 'tws.c.',
};

const CACHE_TTL = 30 * 60 * 1000;       // 行情快取 30 分鐘
const INFO_TTL = 7 * 24 * 60 * 60 * 1000; // 股票清單快取 7 天
const CONCURRENCY = 4;

/* ================= 工具 ================= */

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  keys() {
    try { return Object.keys(localStorage); } catch { return []; }
  },
};

const $ = (sel) => document.querySelector(sel);

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/** 將 x 線性對應到 0–100：x=from 時 0 分、x=to 時 100 分（from 可大於 to 表示越小越好） */
const scale = (x, from, to) => clamp(((x - from) / (to - from)) * 100, 0, 100);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

function weighted(parts) {
  let sum = 0, w = 0;
  for (const [score, weight] of parts) {
    if (isNum(score)) { sum += score * weight; w += weight; }
  }
  return w > 0 ? sum / w : null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(x, digits = 2) {
  return isNum(x) ? x.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
}
function fmtPct(x, digits = 1, sign = true) {
  if (!isNum(x)) return '—';
  return `${sign && x > 0 ? '+' : ''}${x.toFixed(digits)}%`;
}
function fmtLots(shares) {
  if (!isNum(shares)) return '—';
  const lots = Math.round(shares / 1000);
  return `${lots > 0 ? '+' : ''}${lots.toLocaleString('zh-TW')} 張`;
}
const dirClass = (x) => (!isNum(x) || x === 0 ? 'flat' : x > 0 ? 'up' : 'down');

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ================= FinMind API ================= */

class ApiError extends Error {}

async function finmind(dataset, params = {}, { force = false } = {}) {
  const cacheKey = `${LS.cachePrefix}${dataset}.${params.data_id || 'all'}.${params.start_date || ''}`;
  if (!force) {
    const hit = store.get(cacheKey, null);
    if (hit && Date.now() - hit.t < CACHE_TTL) return hit.data;
  }

  const qs = new URLSearchParams({ dataset, ...params });
  const token = store.get(LS.token, '');
  if (token) qs.set('token', token);

  let res;
  try {
    res = await fetch(`${API}?${qs}`);
  } catch (e) {
    throw new ApiError('網路連線失敗，無法連到 FinMind');
  }
  let json;
  try { json = await res.json(); } catch { throw new ApiError(`FinMind 回應格式錯誤 (HTTP ${res.status})`); }
  if (json.status !== 200) {
    const msg = json.msg || `HTTP ${res.status}`;
    if (json.status === 402 || /upper limit/i.test(msg)) {
      throw new ApiError('已達 FinMind 每小時請求上限，請稍後再試或在「設定」填入 token');
    }
    throw new ApiError(`FinMind：${msg}`);
  }
  const data = Array.isArray(json.data) ? json.data : [];
  if (!store.set(cacheKey, { t: Date.now(), data })) {
    purgeCache();
    store.set(cacheKey, { t: Date.now(), data });
  }
  return data;
}

function purgeCache() {
  for (const k of store.keys()) if (k.startsWith(LS.cachePrefix)) store.del(k);
}

/** 取得全市場股票清單 [[id, name, industry], ...]，用於新增時查名稱 */
async function loadStockInfo() {
  const cached = store.get(LS.info, null);
  if (cached && Date.now() - cached.t < INFO_TTL && cached.list?.length) return cached.list;
  const rows = await fetchNoCache('TaiwanStockInfo');
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.stock_id)) map.set(r.stock_id, [r.stock_id, r.stock_name, r.industry_category || '']);
  }
  const list = [...map.values()].sort((a, b) => a[0].localeCompare(b[0]));
  store.set(LS.info, { t: Date.now(), list });
  return list;
}

// 股票清單很大，不放進一般行情快取
async function fetchNoCache(dataset, params = {}) {
  const qs = new URLSearchParams({ dataset, ...params });
  const token = store.get(LS.token, '');
  if (token) qs.set('token', token);
  const res = await fetch(`${API}?${qs}`);
  const json = await res.json();
  if (json.status !== 200) throw new ApiError(json.msg || `HTTP ${res.status}`);
  return json.data || [];
}

/* ================= 指標計算 ================= */

function sma(values, n) {
  if (values.length < n) return null;
  return mean(values.slice(-n));
}

function rsi(values, n = 14) {
  if (values.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgG = gain / n, avgL = loss / n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (n - 1) + Math.max(d, 0)) / n;
    avgL = (avgL * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function rsiScore(r) {
  if (!isNum(r)) return null;
  if (r < 30) return 50;                       // 超賣：可能反彈，但趨勢偏弱
  if (r < 50) return 45 + (r - 30) * 2;        // 45 → 85
  if (r <= 65) return 90;                      // 健康多頭區
  if (r <= 75) return 90 - (r - 65) * 3;       // 90 → 60
  return Math.max(15, 60 - (r - 75) * 3);      // 過熱
}

function computeMetrics(raw) {
  const m = {};

  // ---- 價格 ----
  const prices = (raw.price || []).filter((r) => r.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (prices.length) {
    const closes = prices.map((r) => r.close);
    const last = prices[prices.length - 1];
    m.date = last.date;
    m.price = last.close;
    m.change = last.spread;
    const prev = last.close - last.spread;
    m.changePct = prev > 0 ? (last.spread / prev) * 100 : null;
    m.ma20 = sma(closes, 20);
    m.ma60 = sma(closes, 60);
    m.ret20 = closes.length > 20 ? (last.close / closes[closes.length - 21] - 1) * 100 : null;
    m.rsi = rsi(closes, 14);
    m.closes = closes.slice(-60);
    m.vol10 = prices.slice(-10).reduce((a, r) => a + (r.Trading_Volume || 0), 0);
    m.volume = last.Trading_Volume;
  }

  // ---- 本益比 / 淨值比 / 殖利率 ----
  const per = (raw.per || []).sort((a, b) => a.date.localeCompare(b.date));
  if (per.length) {
    const p = per[per.length - 1];
    m.per = isNum(p.PER) ? p.PER : null;
    m.pbr = isNum(p.PBR) && p.PBR > 0 ? p.PBR : null;
    m.dy = isNum(p.dividend_yield) ? p.dividend_yield : null;
  }

  // ---- 月營收 ----
  const rev = (raw.revenue || []).filter((r) => r.revenue > 0);
  if (rev.length) {
    const byYm = new Map(rev.map((r) => [`${r.revenue_year}-${r.revenue_month}`, r.revenue]));
    const sorted = [...rev].sort((a, b) => (a.revenue_year - b.revenue_year) || (a.revenue_month - b.revenue_month));
    const latest = sorted[sorted.length - 1];
    m.revMonth = `${latest.revenue_year}/${latest.revenue_month}`;
    const prevYear = byYm.get(`${latest.revenue_year - 1}-${latest.revenue_month}`);
    m.revYoY = prevYear ? (latest.revenue / prevYear - 1) * 100 : null;

    const last3 = sorted.slice(-3);
    let cur = 0, base = 0, ok = last3.length === 3;
    for (const r of last3) {
      const b = byYm.get(`${r.revenue_year - 1}-${r.revenue_month}`);
      if (!b) { ok = false; break; }
      cur += r.revenue; base += b;
    }
    m.rev3YoY = ok ? (cur / base - 1) * 100 : null;
  }

  // ---- 三大法人 ----
  const inst = raw.inst || [];
  if (inst.length) {
    const dates = [...new Set(inst.map((r) => r.date))].sort().slice(-10);
    const keep = new Set(dates);
    let net = 0, foreign = 0, trust = 0;
    for (const r of inst) {
      if (!keep.has(r.date)) continue;
      const n = (r.buy || 0) - (r.sell || 0);
      net += n;
      if (r.name === 'Foreign_Investor' || r.name === 'Foreign_Dealer_Self') foreign += n;
      if (r.name === 'Investment_Trust') trust += n;
    }
    m.instNet = net;
    m.foreignNet = foreign;
    m.trustNet = trust;
    m.instRatio = m.vol10 > 0 ? net / m.vol10 : null;
  }

  return m;
}

function score(m) {
  // 技術面
  let trend = null;
  if (isNum(m.price) && isNum(m.ma20)) {
    const checks = [m.price > m.ma20];
    if (isNum(m.ma60)) checks.push(m.ma20 > m.ma60, m.price > m.ma60);
    trend = (checks.filter(Boolean).length / checks.length) * 100;
  }
  const tech = weighted([
    [trend, 0.4],
    [isNum(m.ret20) ? scale(m.ret20, -15, 15) : null, 0.3],
    [rsiScore(m.rsi), 0.3],
  ]);

  // 估值面
  let perS = null;
  if (isNum(m.per)) perS = m.per <= 0 ? 10 : scale(m.per, 40, 10);
  const value = weighted([
    [perS, 0.45],
    [isNum(m.pbr) ? scale(m.pbr, 6, 0.8) : null, 0.2],
    [isNum(m.dy) ? scale(m.dy, 0, 6) : null, 0.35],
  ]);

  // 成長面
  const growth = weighted([
    [isNum(m.revYoY) ? scale(m.revYoY, -20, 40) : null, 0.4],
    [isNum(m.rev3YoY) ? scale(m.rev3YoY, -20, 40) : null, 0.6],
  ]);

  // 籌碼面
  const chips = isNum(m.instRatio) ? scale(m.instRatio, -0.08, 0.08) : null;

  const factors = { tech, value, growth, chips };
  const total = weighted(Object.entries(factors).map(([k, v]) => [v, WEIGHTS[k]]));
  return { factors, total };
}

function gradeOf(total) {
  if (!isNum(total)) return { g: '-', label: '資料不足' };
  if (total >= 80) return { g: 'A+', label: '強力推薦' };
  if (total >= 70) return { g: 'A', label: '值得買進' };
  if (total >= 60) return { g: 'B', label: '可分批布局' };
  if (total >= 50) return { g: 'C', label: '中性觀望' };
  if (total >= 40) return { g: 'D', label: '偏弱保守' };
  return { g: 'E', label: '暫時避開' };
}

function reasons(m) {
  const out = [];
  const add = (cond, text, good) => { if (cond) out.push({ text, good }); };
  if (isNum(m.price) && isNum(m.ma20) && isNum(m.ma60)) {
    add(m.price > m.ma20 && m.ma20 > m.ma60, '均線多頭排列', true);
    add(m.price < m.ma20 && m.ma20 < m.ma60, '均線空頭排列', false);
  }
  add(isNum(m.rsi) && m.rsi > 75, `RSI ${m.rsi?.toFixed(0)} 過熱`, false);
  add(isNum(m.rsi) && m.rsi < 30, `RSI ${m.rsi?.toFixed(0)} 超賣`, false);
  add(isNum(m.per) && m.per > 0 && m.per < 12, `本益比 ${m.per?.toFixed(1)} 偏低`, true);
  add(isNum(m.per) && m.per > 35, `本益比 ${m.per?.toFixed(1)} 偏高`, false);
  add(isNum(m.per) && m.per <= 0, '近四季虧損', false);
  add(isNum(m.dy) && m.dy >= 5, `殖利率 ${m.dy?.toFixed(2)}% 高`, true);
  add(isNum(m.rev3YoY) && m.rev3YoY >= 20, `近3月營收年增 ${m.rev3YoY?.toFixed(0)}%`, true);
  add(isNum(m.rev3YoY) && m.rev3YoY <= -10, `近3月營收年減 ${Math.abs(m.rev3YoY ?? 0).toFixed(0)}%`, false);
  add(isNum(m.instRatio) && m.instRatio >= 0.03, '法人近10日明顯買超', true);
  add(isNum(m.instRatio) && m.instRatio <= -0.03, '法人近10日明顯賣超', false);
  add(isNum(m.trustNet) && isNum(m.vol10) && m.vol10 > 0 && m.trustNet / m.vol10 >= 0.01, '投信連續布局', true);
  return out;
}

async function analyze(stock, force) {
  const id = stock.id;
  const get = (dataset, start) =>
    finmind(dataset, { data_id: id, start_date: start }, { force }).catch((e) => ({ error: e }));

  const [price, per, revenue, inst] = await Promise.all([
    get('TaiwanStockPrice', daysAgo(130)),
    get('TaiwanStockPER', daysAgo(20)),
    get('TaiwanStockMonthRevenue', daysAgo(500)),
    get('TaiwanStockInstitutionalInvestorsBuySell', daysAgo(25)),
  ]);

  if (price.error) throw price.error;
  if (!price.length) throw new ApiError('查無行情資料，請確認代號是否正確');

  const raw = {
    price,
    per: per.error ? [] : per,
    revenue: revenue.error ? [] : revenue,
    inst: inst.error ? [] : inst,
  };
  const metrics = computeMetrics(raw);
  const s = score(metrics);
  return { metrics, ...s, grade: gradeOf(s.total), reasons: reasons(metrics) };
}

/* ================= 狀態 ================= */

const state = {
  watch: store.get(LS.watch, null) || DEFAULT_WATCHLIST.slice(),
  results: new Map(), // id -> { status: 'loading'|'ok'|'error', data, error }
  info: [],
  infoMap: new Map(),
  loading: false,
};

function saveWatch() { store.set(LS.watch, state.watch); }

function setMessage(text, isError = false) {
  const el = $('#message');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

/* ================= 動作 ================= */

async function refresh(force = false) {
  if (state.loading) return;
  state.loading = true;
  $('#btnRefresh').disabled = true;
  for (const s of state.watch) {
    const prev = state.results.get(s.id);
    state.results.set(s.id, { ...prev, status: 'loading' });
  }
  render();

  let done = 0, failed = 0, lastErr = '';
  await pool(state.watch.slice(), CONCURRENCY, async (stock) => {
    try {
      const data = await analyze(stock, force);
      state.results.set(stock.id, { status: 'ok', data });
    } catch (e) {
      failed++;
      lastErr = e.message;
      state.results.set(stock.id, { status: 'error', error: e.message });
    }
    done++;
    setMessage(`載入中… ${done} / ${state.watch.length}`);
    render();
  });

  state.loading = false;
  $('#btnRefresh').disabled = false;
  const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  if (failed) setMessage(`更新完成（${time}），${failed} 支失敗：${lastErr}`, true);
  else setMessage(`更新完成（${time}）`);
  render();
}

async function refreshOne(stock) {
  state.results.set(stock.id, { status: 'loading' });
  render();
  try {
    const data = await analyze(stock, false);
    state.results.set(stock.id, { status: 'ok', data });
    setMessage(`已加入 ${stock.name || stock.id}`);
  } catch (e) {
    state.results.set(stock.id, { status: 'error', error: e.message });
    setMessage(`${stock.id} 載入失敗：${e.message}`, true);
  }
  render();
}

function resolveInput(text) {
  const q = text.trim();
  if (!q) return null;
  const code = q.match(/^[0-9A-Za-z]{4,6}/)?.[0]?.toUpperCase();
  if (code) {
    const hit = state.infoMap.get(code);
    return { id: code, name: hit ? hit[1] : (q.slice(code.length).trim() || '') };
  }
  const exact = state.info.find((r) => r[1] === q);
  if (exact) return { id: exact[0], name: exact[1] };
  const partial = state.info.filter((r) => r[1].includes(q));
  if (partial.length === 1) return { id: partial[0][0], name: partial[0][1] };
  if (partial.length > 1) {
    setMessage(`「${q}」符合多支股票：${partial.slice(0, 6).map((r) => `${r[0]} ${r[1]}`).join('、')}…請輸入代號`, true);
    return undefined;
  }
  setMessage(state.info.length ? `找不到「${q}」` : '股票清單尚未載入，請直接輸入代號', true);
  return undefined;
}

function addStock(text) {
  const stock = resolveInput(text);
  if (!stock) return;
  if (state.watch.some((s) => s.id === stock.id)) {
    setMessage(`${stock.id} ${stock.name} 已在觀察清單中`, true);
    return;
  }
  state.watch.push(stock);
  saveWatch();
  $('#addInput').value = '';
  refreshOne(stock);
}

function removeStock(id) {
  const s = state.watch.find((x) => x.id === id);
  state.watch = state.watch.filter((x) => x.id !== id);
  state.results.delete(id);
  saveWatch();
  setMessage(`已移除 ${id} ${s?.name || ''}`);
  render();
}

/* ================= 畫面 ================= */

function sparkline(closes) {
  if (!closes || closes.length < 2) return '<svg class="spark"></svg>';
  const w = 120, h = 40, pad = 2;
  const min = Math.min(...closes), max = Math.max(...closes);
  const span = max - min || 1;
  const pts = closes.map((c, i) => {
    const x = pad + (i / (closes.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (c - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? 'var(--up)' : 'var(--down)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="近 ${closes.length} 日走勢">
    <polyline fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" points="${pts.join(' ')}"/>
  </svg>`;
}

function sortKey(entry, key) {
  const d = entry.res?.data;
  if (!d) return -Infinity;
  if (key === 'score') return d.total ?? -Infinity;
  if (key in WEIGHTS) return d.factors[key] ?? -Infinity;
  return d.metrics[key] ?? -Infinity;
}

function render() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const minGrade = Number($('#gradeFilter').value);
  const sortBy = $('#sortSelect').value;

  const all = state.watch.map((s) => ({ stock: s, res: state.results.get(s.id) }));
  // 依綜合分數排名（不受篩選影響）
  const ranked = all
    .filter((e) => e.res?.data && isNum(e.res.data.total))
    .sort((a, b) => b.res.data.total - a.res.data.total);
  const rankOf = new Map(ranked.map((e, i) => [e.stock.id, i + 1]));

  let rows = all.filter((e) => {
    if (q && !e.stock.id.toLowerCase().includes(q) && !(e.stock.name || '').toLowerCase().includes(q)) return false;
    if (minGrade > 0) return isNum(e.res?.data?.total) && e.res.data.total >= minGrade;
    return true;
  });
  rows.sort((a, b) => sortKey(b, sortBy) - sortKey(a, sortBy));

  renderSummary(ranked);

  const list = $('#list');
  if (!state.watch.length) {
    list.innerHTML = '<p class="empty">觀察清單是空的，請從上方新增股票。</p>';
    return;
  }
  if (!rows.length) {
    list.innerHTML = '<p class="empty">沒有符合篩選條件的股票。</p>';
    return;
  }
  list.innerHTML = rows.map((e) => cardHtml(e.stock, e.res, rankOf.get(e.stock.id))).join('');
}

function renderSummary(ranked) {
  const scores = ranked.map((e) => e.res.data.total);
  const buyable = scores.filter((s) => s >= 70).length;
  const best = ranked[0];
  const latestDate = ranked.map((e) => e.res.data.metrics.date).filter(Boolean).sort().pop();
  $('#summary').innerHTML = [
    ['觀察股票', `${state.watch.length} 支`],
    ['A 級以上', `${buyable} 支`],
    ['平均分數', scores.length ? mean(scores).toFixed(1) : '—'],
    ['首選 / 資料日', best ? `${escapeHtml(best.stock.name || best.stock.id)}<span style="font-size:12px;color:var(--muted);font-weight:400"> · ${latestDate || ''}</span>` : '—'],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
}

function cardHtml(stock, res, rank) {
  const info = state.infoMap.get(stock.id);
  const name = escapeHtml(stock.name || info?.[1] || stock.id);
  const industry = info?.[2] ? `<div class="industry">${escapeHtml(info[2])}</div>` : '';
  const del = `<button class="del" type="button" data-del="${escapeHtml(stock.id)}" title="從觀察清單移除" aria-label="移除 ${name}">×</button>`;
  const nameHtml = `<div class="name"><span class="title">${name}</span><span class="code">${escapeHtml(stock.id)}</span>${industry}</div>`;

  if (!res || res.status === 'error' || (res.status === 'loading' && !res.data)) {
    const msg = res?.status === 'error' ? `<div class="err">⚠ ${escapeHtml(res.error)}</div>` : '';
    return `<article class="card ${res?.status === 'loading' ? 'loading' : ''}">
      <div class="rank">–</div>${nameHtml}
      <div class="price"><div class="d">${res?.status === 'loading' ? '載入中…' : ''}</div></div>
      <div class="sparkwrap"></div><div class="score"></div><div class="factors"></div>${del}${msg}
    </article>`;
  }

  const { metrics: m, factors, total, grade, reasons: rs } = res.data;
  const cls = dirClass(m.change);
  const arrow = m.change > 0 ? '▲' : m.change < 0 ? '▼' : '';
  const factorRows = Object.keys(WEIGHTS).map((k) => {
    const v = factors[k];
    return `<span class="fl">${FACTOR_LABELS[k]}</span>
      <span class="bar"><i style="width:${isNum(v) ? v.toFixed(0) : 0}%"></i></span>
      <span class="fv">${isNum(v) ? v.toFixed(0) : '—'}</span>`;
  }).join('');

  const details = [
    ['本益比', fmt(m.per, 1)],
    ['淨值比', fmt(m.pbr, 2)],
    ['殖利率', isNum(m.dy) ? `${m.dy.toFixed(2)}%` : '—'],
    ['RSI14', fmt(m.rsi, 0)],
    ['20日報酬', `<span class="${dirClass(m.ret20)}">${fmtPct(m.ret20)}</span>`],
    [`營收年增${m.revMonth ? `(${m.revMonth})` : ''}`, `<span class="${dirClass(m.revYoY)}">${fmtPct(m.revYoY)}</span>`],
    ['近3月營收年增', `<span class="${dirClass(m.rev3YoY)}">${fmtPct(m.rev3YoY)}</span>`],
    ['外資10日', `<span class="${dirClass(m.foreignNet)}">${fmtLots(m.foreignNet)}</span>`],
    ['投信10日', `<span class="${dirClass(m.trustNet)}">${fmtLots(m.trustNet)}</span>`],
  ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');

  const tags = rs.length
    ? `<div class="tags">${rs.map((r) => `<span class="tag ${r.good ? 'good' : 'bad'}">${escapeHtml(r.text)}</span>`).join('')}</div>`
    : '';

  return `<article class="card ${res.status === 'loading' ? 'loading' : ''}">
    <div class="rank ${rank && rank <= 3 ? 'top' : ''}">${rank ?? '–'}</div>
    ${nameHtml}
    <div class="price">
      <div class="p ${cls}">${fmt(m.price, 2)}</div>
      <div class="c ${cls}">${arrow} ${fmt(Math.abs(m.change ?? NaN), 2)} (${fmtPct(m.changePct, 2)})</div>
      <div class="d">${m.date || ''}</div>
    </div>
    <div class="sparkwrap">${sparkline(m.closes)}</div>
    <div class="score">
      <span class="grade" data-g="${grade.g}">${grade.g}</span>
      <div><div class="num">${isNum(total) ? total.toFixed(1) : '—'}</div><div class="label">${grade.label}</div></div>
    </div>
    <div class="factors">${factorRows}</div>
    ${del}
    <div class="detail">${details}</div>
    ${tags}
  </article>`;
}

/* ================= 初始化 ================= */

function bindEvents() {
  $('#btnRefresh').addEventListener('click', () => refresh(true));

  $('#btnSettings').addEventListener('click', () => {
    const panel = $('#settings');
    panel.hidden = !panel.hidden;
    $('#btnSettings').setAttribute('aria-expanded', String(!panel.hidden));
  });

  $('#tokenInput').value = store.get(LS.token, '');
  $('#btnSaveToken').addEventListener('click', () => {
    store.set(LS.token, $('#tokenInput').value.trim());
    setMessage('Token 已儲存');
    refresh(true);
  });

  $('#btnReset').addEventListener('click', () => {
    if (!confirm('確定要把觀察清單恢復成預設 20 支股票嗎？')) return;
    state.watch = DEFAULT_WATCHLIST.slice();
    state.results.clear();
    saveWatch();
    refresh();
  });

  $('#btnClearCache').addEventListener('click', () => {
    purgeCache();
    store.del(LS.info);
    setMessage('已清除快取');
  });

  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    addStock($('#addInput').value);
  });

  $('#list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (btn) removeStock(btn.dataset.del);
  });

  $('#searchInput').addEventListener('input', render);
  $('#gradeFilter').addEventListener('change', render);
  $('#sortSelect').addEventListener('change', render);
}

async function init() {
  bindEvents();
  render();
  loadStockInfo()
    .then((list) => {
      state.info = list;
      state.infoMap = new Map(list.map((r) => [r[0], r]));
      $('#stockList').innerHTML = list.map((r) => `<option value="${escapeHtml(`${r[0]} ${r[1]}`)}"></option>`).join('');
      render();
    })
    .catch(() => { /* 清單載入失敗不影響主要功能，新增時改以代號查詢 */ });
  refresh();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  init();
}
