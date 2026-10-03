/* 天氣儀表板 — 資料來源：Open-Meteo（免金鑰、支援 CORS） */
(() => {
  'use strict';

  const API = {
    forecast: 'https://api.open-meteo.com/v1/forecast',
    air: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    geocode: 'https://geocoding-api.open-meteo.com/v1/search',
    reverse: 'https://api.bigdatacloud.net/data/reverse-geocode-client',
  };
  const REFRESH_MS = 10 * 60 * 1000;
  const DEFAULT_PLACE = { name: '臺北市', sub: '臺灣', lat: 25.0478, lon: 121.5319 };
  const STORE = { place: 'wx.place', recent: 'wx.recent', unit: 'wx.unit' };

  const $ = (id) => document.getElementById(id);
  const el = {
    body: document.body,
    dashboard: $('dashboard'),
    banner: $('banner'),
    form: $('searchForm'),
    input: $('searchInput'),
    suggestions: $('suggestions'),
    recent: $('recent'),
    locateBtn: $('locateBtn'),
    refreshBtn: $('refreshBtn'),
    placeName: $('placeName'),
    placeSub: $('placeSub'),
    updated: $('updated'),
    heroIcon: $('heroIcon'),
    curTemp: $('curTemp'),
    curCond: $('curCond'),
    curHiLo: $('curHiLo'),
    summary: $('summary'),
    aqiArc: $('aqiArc'),
    aqiValue: $('aqiValue'),
    aqiLabel: $('aqiLabel'),
    pm25: $('pm25'),
    pm10: $('pm10'),
    o3: $('o3'),
    hourly: $('hourly'),
    details: $('details'),
    daily: $('daily'),
  };

  const state = {
    place: load(STORE.place, DEFAULT_PLACE),
    recent: load(STORE.recent, []),
    unit: load(STORE.unit, 'C'),
    weather: null,
    air: null,
    lastFetch: 0,
    timer: null,
    reqId: 0,
  };

  /* ---------- 儲存（localStorage 可能不可用） ---------- */
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 忽略 */ }
  }

  /* ---------- 工具 ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round = (n) => (n == null || Number.isNaN(n) ? '--' : Math.round(n));
  const toUnit = (c) => (c == null ? null : state.unit === 'F' ? c * 9 / 5 + 32 : c);
  const t = (c) => `${round(toUnit(c))}°`;
  const hhmm = (iso) => iso ? iso.slice(11, 16) : '--:--';
  const DROP = '<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M6 1C4 5 1 8 1 11a5 5 0 0 0 10 0c0-3-3-6-5-10z" fill="currentColor"/></svg>';
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  async function getJSON(url, params) {
    const u = new URL(url);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ---------- 天氣代碼（WMO） ---------- */
  const WMO = {
    0: ['晴朗', 'clear'], 1: ['大致晴朗', 'partly'], 2: ['局部多雲', 'partly'], 3: ['陰天', 'cloudy'],
    45: ['有霧', 'fog'], 48: ['霧淞', 'fog'],
    51: ['輕微毛毛雨', 'drizzle'], 53: ['毛毛雨', 'drizzle'], 55: ['濃密毛毛雨', 'drizzle'],
    56: ['凍毛毛雨', 'drizzle'], 57: ['強凍毛毛雨', 'drizzle'],
    61: ['小雨', 'rain'], 63: ['中雨', 'rain'], 65: ['大雨', 'rain'],
    66: ['凍雨', 'rain'], 67: ['強凍雨', 'rain'],
    71: ['小雪', 'snow'], 73: ['中雪', 'snow'], 75: ['大雪', 'snow'], 77: ['雪粒', 'snow'],
    80: ['短暫陣雨', 'rain'], 81: ['陣雨', 'rain'], 82: ['強陣雨', 'rain'],
    85: ['陣雪', 'snow'], 86: ['強陣雪', 'snow'],
    95: ['雷雨', 'thunder'], 96: ['雷雨夾冰雹', 'thunder'], 99: ['強雷雨夾冰雹', 'thunder'],
  };
  const wmo = (code) => WMO[code] || ['未知', 'cloudy'];

  function themeFor(code, isDay) {
    const kind = wmo(code)[1];
    if (kind === 'clear' || kind === 'partly') return isDay ? 'clear-day' : 'clear-night';
    if (kind === 'cloudy') return isDay ? 'cloudy' : 'cloudy-night';
    if (kind === 'drizzle') return 'rain';
    return kind;
  }

  /* ---------- SVG 圖示 ---------- */
  const SUN = (cx, cy, r) => {
    let rays = '';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const x1 = cx + Math.cos(a) * (r + 5), y1 = cy + Math.sin(a) * (r + 5);
      const x2 = cx + Math.cos(a) * (r + 10), y2 = cy + Math.sin(a) * (r + 10);
      rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }
    return `<g stroke="#ffc94a" stroke-width="3" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#gSun)"/>`;
  };
  const MOON = (cx, cy, r) =>
    `<path d="M${cx + r * 0.35} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.65} ${r * 1.55} a${r * 0.8} ${r * 0.8} 0 0 1 -${r * 0.65} -${r * 1.55}z" fill="url(#gMoon)"/>`;
  const CLOUD = (dx = 0, dy = 0, s = 1, dark = false) =>
    `<path transform="translate(${dx} ${dy}) scale(${s})" d="M18 50h30a11 11 0 0 0 1.5-21.9A15 15 0 0 0 20.6 25 12.5 12.5 0 0 0 18 50z" fill="url(#${dark ? 'gCloudDark' : 'gCloud'})"/>`;
  const DROPS = (n = 3, color = '#7cc6ff') => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const x = 24 + i * 9;
      s += `<line x1="${x}" y1="52" x2="${x - 3}" y2="60" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
    }
    return s;
  };
  const FLAKES = () => [22, 32, 42].map((x, i) => `<circle cx="${x}" cy="${56 + (i % 2) * 3}" r="2.6" fill="#fff"/>`).join('');
  const BOLT = '<path d="M34 46l-7 10h6l-3 8 9-12h-6l4-6z" fill="#ffd166"/>';
  const FOG = '<g stroke="#e6edf5" stroke-width="3" stroke-linecap="round" opacity=".9"><line x1="12" y1="50" x2="52" y2="50"/><line x1="16" y1="56" x2="48" y2="56"/></g>';
  const DEFS = `<defs>
    <radialGradient id="gSun" cx=".4" cy=".4"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#ffb300"/></radialGradient>
    <linearGradient id="gMoon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffbe6"/><stop offset="1" stop-color="#d8cfa4"/></linearGradient>
    <linearGradient id="gCloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6e2ef"/></linearGradient>
    <linearGradient id="gCloudDark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d3df"/><stop offset="1" stop-color="#8a9bb0"/></linearGradient>
  </defs>`;

  function iconSVG(code, isDay = 1, size = 64) {
    const kind = wmo(code)[1];
    const sky = isDay ? SUN(32, 30, 12) : MOON(32, 30, 13);
    const skySmall = isDay ? SUN(24, 22, 9) : MOON(24, 22, 10);
    let body;
    switch (kind) {
      case 'clear': body = sky; break;
      case 'partly': body = skySmall + CLOUD(6, 6, 0.85); break;
      case 'cloudy': body = CLOUD(-6, -6, 0.75, true) + CLOUD(2, 4, 0.9); break;
      case 'fog': body = CLOUD(0, -8, 0.9) + FOG; break;
      case 'drizzle': body = CLOUD(0, -6, 0.9) + DROPS(3, '#a8d8ff'); break;
      case 'rain': body = CLOUD(0, -6, 0.9, true) + DROPS(3); break;
      case 'snow': body = CLOUD(0, -6, 0.9) + FLAKES(); break;
      case 'thunder': body = CLOUD(0, -8, 0.9, true) + BOLT; break;
      default: body = CLOUD(0, 0, 0.9);
    }
    return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${esc(wmo(code)[0])}">${body}</svg>`;
  }

  // 共用的漸層定義只放一次
  const defsHost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defsHost.setAttribute('width', '0');
  defsHost.setAttribute('height', '0');
  defsHost.setAttribute('aria-hidden', 'true');
  defsHost.style.position = 'absolute';
  defsHost.innerHTML = DEFS;
  document.body.prepend(defsHost);

  /* ---------- 取得資料 ---------- */
  async function fetchAll({ silent = false } = {}) {
    const { lat, lon } = state.place;
    const id = ++state.reqId;
    el.refreshBtn.classList.add('spinning');
    if (!silent) el.dashboard.setAttribute('aria-busy', 'true');

    try {
      const [weather, air] = await Promise.all([
        getJSON(API.forecast, {
          latitude: lat, longitude: lon, timezone: 'auto', forecast_days: 7,
          current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
          hourly: 'temperature_2m,precipitation_probability,weather_code,is_day,uv_index,visibility,dew_point_2m',
          daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
        }),
        // 空氣品質失敗不影響主要畫面
        getJSON(API.air, {
          latitude: lat, longitude: lon, timezone: 'auto',
          current: 'us_aqi,pm2_5,pm10,ozone',
        }).catch(() => null),
      ]);
      if (id !== state.reqId) return; // 已被較新的請求取代
      state.weather = weather;
      state.air = air;
      state.lastFetch = Date.now();
      hideBanner();
      render();
    } catch (err) {
      if (id !== state.reqId) return;
      showBanner(`無法取得天氣資料（${err.message}），請檢查網路後再試一次。`);
    } finally {
      if (id === state.reqId) {
        el.refreshBtn.classList.remove('spinning');
        el.dashboard.setAttribute('aria-busy', 'false');
      }
    }
  }

  function scheduleRefresh() {
    clearInterval(state.timer);
    state.timer = setInterval(() => fetchAll({ silent: true }), REFRESH_MS);
  }

  /* ---------- 繪製 ---------- */
  function render() {
    const w = state.weather;
    if (!w) return;
    const cur = w.current;
    const d = w.daily;

    el.body.className = `theme-${themeFor(cur.weather_code, cur.is_day)}`;
    document.title = `${round(toUnit(cur.temperature_2m))}° ${state.place.name} · 天氣儀表板`;

    // 目前天氣
    el.placeName.textContent = state.place.name;
    el.placeSub.textContent = [state.place.sub, `${state.place.lat.toFixed(2)}, ${state.place.lon.toFixed(2)}`].filter(Boolean).join(' · ');
    const now = new Date(state.lastFetch);
    el.updated.textContent = `更新於 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} · 當地 ${hhmm(cur.time)}`;
    el.heroIcon.innerHTML = iconSVG(cur.weather_code, cur.is_day, 130);
    el.curTemp.textContent = t(cur.temperature_2m);
    el.curCond.textContent = wmo(cur.weather_code)[0];
    el.curHiLo.textContent = `最高 ${t(d.temperature_2m_max[0])} · 最低 ${t(d.temperature_2m_min[0])} · 體感 ${t(cur.apparent_temperature)}`;
    el.summary.textContent = buildSummary(w);

    renderAir();
    renderHourly(w);
    renderDetails(w);
    renderDaily(w);
    renderRecent();
  }

  function buildSummary(w) {
    const cur = w.current, d = w.daily;
    const parts = [];
    const pop = d.precipitation_probability_max[0];
    parts.push(`今天${wmo(d.weather_code[0])[0]}，氣溫 ${t(d.temperature_2m_min[0])} 至 ${t(d.temperature_2m_max[0])}`);
    if (pop != null) parts.push(pop >= 60 ? `降雨機率 ${pop}%，記得帶傘` : pop >= 30 ? `降雨機率 ${pop}%，建議備傘` : `降雨機率 ${pop}%`);
    const uv = d.uv_index_max[0];
    if (uv >= 6) parts.push(`紫外線${uvLevel(uv).label}，注意防曬`);
    if (cur.wind_gusts_10m >= 50) parts.push(`陣風可達 ${round(cur.wind_gusts_10m)} km/h`);
    return parts.join('；') + '。';
  }

  function aqiLevel(v) {
    if (v == null) return { label: '無資料', color: 'rgba(255,255,255,.4)' };
    if (v <= 50) return { label: '良好', color: '#6ee7a8' };
    if (v <= 100) return { label: '普通', color: '#ffd166' };
    if (v <= 150) return { label: '對敏感族群不健康', color: '#ff9f5a' };
    if (v <= 200) return { label: '對所有族群不健康', color: '#ff6b6b' };
    if (v <= 300) return { label: '非常不健康', color: '#b57cff' };
    return { label: '危害', color: '#c0365b' };
  }

  function renderAir() {
    const a = state.air && state.air.current;
    const v = a ? a.us_aqi : null;
    const lvl = aqiLevel(v);
    const len = 157.08;
    el.aqiArc.style.stroke = lvl.color;
    el.aqiArc.style.strokeDashoffset = v == null ? len : len * (1 - Math.min(v, 300) / 300);
    el.aqiValue.textContent = round(v);
    el.aqiLabel.textContent = `${lvl.label}${v == null ? '' : '（美國 AQI）'}`;
    el.pm25.textContent = a ? `${round(a.pm2_5)} µg/m³` : '--';
    el.pm10.textContent = a ? `${round(a.pm10)} µg/m³` : '--';
    el.o3.textContent = a ? `${round(a.ozone)} µg/m³` : '--';
  }

  function currentHourIndex(w) {
    const key = w.current.time.slice(0, 13); // "YYYY-MM-DDTHH"
    const i = w.hourly.time.findIndex((x) => x.slice(0, 13) >= key);
    return i < 0 ? 0 : i;
  }

  function renderHourly(w) {
    const h = w.hourly;
    const start = currentHourIndex(w);
    const n = Math.min(24, h.time.length - start);
    if (n <= 0) { el.hourly.innerHTML = ''; return; }

    const col = 60, W = col * n, H = 210;
    const top = 92, bottom = 160; // 溫度曲線區
    const temps = [], pts = [];
    for (let i = 0; i < n; i++) temps.push(toUnit(h.temperature_2m[start + i]));
    const min = Math.min(...temps), max = Math.max(...temps);
    const span = max - min || 1;
    temps.forEach((v, i) => pts.push([col * i + col / 2, bottom - ((v - min) / span) * (bottom - top)]));

    // 平滑曲線（Catmull-Rom → Bezier）
    let line = `M${pts[0][0]} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      line += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0]} ${p2[1].toFixed(1)}`;
    }
    const area = `${line} L${pts[pts.length - 1][0]} ${H - 22} L${pts[0][0]} ${H - 22} Z`;

    let cols = '';
    for (let i = 0; i < n; i++) {
      const k = start + i;
      const x = col * i + col / 2;
      const pop = h.precipitation_probability[k] ?? 0;
      const barH = (pop / 100) * 28;
      const isNow = i === 0;
      const hour = h.time[k].slice(11, 13);
      const dayChange = hour === '00' ? `<line x1="${col * i}" y1="8" x2="${col * i}" y2="${H - 6}" stroke="rgba(255,255,255,.18)" stroke-dasharray="3 4"/>` : '';
      cols += `${dayChange}
        <text class="h-time ${isNow ? 'h-now' : ''}" x="${x}" y="18" text-anchor="middle">${isNow ? '現在' : hour === '00' ? `${h.time[k].slice(5, 7)}/${h.time[k].slice(8, 10)}` : `${hour}時`}</text>
        <svg x="${x - 16}" y="26" width="32" height="32" viewBox="0 0 64 64">${iconSVG(h.weather_code[k], h.is_day[k], 64).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
        <text class="h-temp" x="${x}" y="${pts[i][1] - 10}" text-anchor="middle">${round(temps[i])}°</text>
        <circle cx="${x}" cy="${pts[i][1]}" r="${isNow ? 4.5 : 3}" fill="${isNow ? '#ffd166' : '#fff'}"/>
        <rect x="${x - 9}" y="${H - 22 - barH}" width="18" height="${barH}" rx="3" fill="rgba(124,198,255,.55)"/>
        <text class="h-pop" x="${x}" y="${H - 6}" text-anchor="middle">${pop}%</text>`;
    }

    el.hourly.innerHTML = `
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="未來 ${n} 小時溫度與降雨機率">
        <defs>
          <linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffd166" stop-opacity=".45"/>
            <stop offset="1" stop-color="#ffd166" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#gArea)"/>
        <path d="${line}" fill="none" stroke="#ffd166" stroke-width="2.5" stroke-linecap="round"/>
        ${cols}
      </svg>`;
  }

  function uvLevel(v) {
    if (v == null) return { label: '--', color: '#888' };
    if (v < 3) return { label: '低', color: '#6ee7a8' };
    if (v < 6) return { label: '中', color: '#ffd166' };
    if (v < 8) return { label: '高', color: '#ff9f5a' };
    if (v < 11) return { label: '過高', color: '#ff6b6b' };
    return { label: '危險', color: '#b57cff' };
  }

  function windDir(deg) {
    const dirs = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
    return dirs[Math.round(deg / 45) % 8] + '風';
  }

  function renderDetails(w) {
    const cur = w.current, d = w.daily, h = w.hourly;
    const k = currentHourIndex(w);
    const uv = h.uv_index[k];
    const uvl = uvLevel(uv);
    const vis = h.visibility[k];
    const dew = h.dew_point_2m[k];

    // 日出日落進度
    const sr = d.sunrise[0], ss = d.sunset[0];
    const mins = (iso) => +iso.slice(11, 13) * 60 + +iso.slice(14, 16);
    const nowM = mins(cur.time), srM = mins(sr), ssM = mins(ss);
    const dayPct = Math.max(0, Math.min(100, ((nowM - srM) / (ssM - srM)) * 100));
    const dayLen = ssM - srM;

    const arrow = `<svg class="wind-arrow" viewBox="0 0 24 24" style="transform:rotate(${cur.wind_direction_10m + 180}deg)"><path d="M12 3l5 14-5-3-5 3z" fill="currentColor"/></svg>`;

    const tiles = [
      ['體感溫度', t(cur.apparent_temperature), cur.apparent_temperature < cur.temperature_2m - 1 ? '感覺比實際涼' : cur.apparent_temperature > cur.temperature_2m + 1 ? '感覺比實際熱' : '與實際溫度相近'],
      ['濕度', `${round(cur.relative_humidity_2m)}<small>%</small>`, `露點 ${t(dew)}`, meter(cur.relative_humidity_2m, '#7cc6ff')],
      ['風速', `${round(cur.wind_speed_10m)}<small>km/h</small>${arrow}`, `${windDir(cur.wind_direction_10m)} · 陣風 ${round(cur.wind_gusts_10m)} km/h`],
      ['紫外線', `${uv == null ? '--' : uv.toFixed(1)}<small>${uvl.label}</small>`, `今日最高 ${d.uv_index_max[0] == null ? '--' : d.uv_index_max[0].toFixed(1)}`, meter(Math.min((uv || 0) / 11 * 100, 100), uvl.color)],
      ['氣壓', `${round(cur.pressure_msl)}<small>hPa</small>`, cur.pressure_msl < 1005 ? '偏低' : cur.pressure_msl > 1020 ? '偏高' : '正常'],
      ['能見度', vis == null ? '--' : vis >= 1000 ? `${(vis / 1000).toFixed(vis >= 10000 ? 0 : 1)}<small>km</small>` : `${round(vis)}<small>m</small>`, vis >= 10000 ? '視野清晰' : vis >= 4000 ? '略有影響' : '視野不佳'],
      ['雲量', `${round(cur.cloud_cover)}<small>%</small>`, `今日降雨 ${d.precipitation_sum[0] ?? 0} mm`, meter(cur.cloud_cover, '#cfd8e3')],
      ['日出 / 日落', `${hhmm(sr)}<small>/ ${hhmm(ss)}</small>`, `日照 ${Math.floor(dayLen / 60)} 小時 ${dayLen % 60} 分`, meter(dayPct, '#ffd166')],
    ];

    el.details.innerHTML = tiles.map(([label, value, note, extra]) => `
      <div class="tile">
        <div class="tile-label">${label}</div>
        <div class="tile-value">${value}</div>
        <div class="tile-note">${note}</div>
        ${extra || ''}
      </div>`).join('');
  }

  const meter = (pct, color) => `<div class="meter"><span style="width:${Math.max(0, Math.min(100, pct || 0))}%;background:${color}"></span></div>`;

  function renderDaily(w) {
    const d = w.daily;
    const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max);
    const span = hi - lo || 1;
    el.daily.innerHTML = d.time.map((day, i) => {
      const date = new Date(`${day}T12:00:00`);
      const name = i === 0 ? '今天' : i === 1 ? '明天' : `週${WEEK[date.getDay()]}`;
      const left = ((d.temperature_2m_min[i] - lo) / span) * 100;
      const width = ((d.temperature_2m_max[i] - d.temperature_2m_min[i]) / span) * 100;
      const pop = d.precipitation_probability_max[i];
      return `<li title="${esc(wmo(d.weather_code[i])[0])}">
        <span class="d-name">${name}</span>
        <span class="d-icon">${iconSVG(d.weather_code[i], 1, 34)}</span>
        <span class="d-pop">${pop >= 10 ? `${DROP}${pop}%` : ''}</span>
        <span class="d-min">${t(d.temperature_2m_min[i])}</span>
        <span class="range"><span style="left:${left}%;width:${Math.max(width, 4)}%"></span></span>
        <span class="d-max">${t(d.temperature_2m_max[i])}</span>
      </li>`;
    }).join('');
  }

  /* ---------- 最近查詢 ---------- */
  const samePlace = (a, b) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

  function renderRecent() {
    el.recent.innerHTML = state.recent.map((p, i) => `
      <button type="button" class="chip ${samePlace(p, state.place) ? 'current' : ''}" data-i="${i}">
        ${esc(p.name)}<span class="x" data-remove="${i}" title="移除" aria-label="移除 ${esc(p.name)}">×</span>
      </button>`).join('');
  }

  el.recent.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      e.stopPropagation();
      state.recent.splice(+rm.dataset.remove, 1);
      save(STORE.recent, state.recent);
      renderRecent();
      return;
    }
    const chip = e.target.closest('.chip');
    if (chip) setPlace(state.recent[+chip.dataset.i]);
  });

  function setPlace(place) {
    state.place = place;
    save(STORE.place, place);
    state.recent = [place, ...state.recent.filter((p) => !samePlace(p, place))].slice(0, 8);
    save(STORE.recent, state.recent);
    el.placeName.textContent = place.name;
    renderRecent();
    fetchAll();
    scheduleRefresh();
  }

  /* ---------- 搜尋 ---------- */
  let searchTimer = null, results = [], active = -1, searchId = 0;

  async function search(q) {
    const id = ++searchId;
    try {
      let data = await getJSON(API.geocode, { name: q, count: 8, language: 'zh', format: 'json' });
      if (!data.results) data = await getJSON(API.geocode, { name: q, count: 8, language: 'en', format: 'json' });
      if (id !== searchId) return;
      results = (data.results || []).map((r) => ({
        name: r.name,
        sub: [r.admin1, r.country].filter((x, i, a) => x && a.indexOf(x) === i).join('，'),
        lat: r.latitude,
        lon: r.longitude,
      }));
    } catch {
      if (id !== searchId) return;
      results = [];
    }
    active = results.length ? 0 : -1;
    showSuggestions(q);
  }

  function showSuggestions(q) {
    if (!el.input.value.trim()) { hideSuggestions(); return; }
    el.suggestions.innerHTML = results.length
      ? results.map((r, i) => `<li role="option" data-i="${i}" aria-selected="${i === active}">
          <span>${esc(r.name)}</span><span class="s-sub">${esc(r.sub)}</span></li>`).join('')
      : `<li class="empty">找不到「${esc(q)}」，試試其他寫法或英文名稱</li>`;
    el.suggestions.hidden = false;
    el.input.setAttribute('aria-expanded', 'true');
  }

  function hideSuggestions() {
    el.suggestions.hidden = true;
    el.input.setAttribute('aria-expanded', 'false');
  }

  function choose(i) {
    const r = results[i];
    if (!r) return;
    el.input.value = '';
    hideSuggestions();
    el.input.blur();
    setPlace(r);
  }

  el.input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = el.input.value.trim();
    if (!q) { searchId++; hideSuggestions(); return; }
    searchTimer = setTimeout(() => search(q), 280);
  });

  el.input.addEventListener('keydown', (e) => {
    if (el.suggestions.hidden || !results.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      [...el.suggestions.children].forEach((li, i) => li.setAttribute('aria-selected', i === active));
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = el.input.value.trim();
    if (!q) return;
    if (el.suggestions.hidden || !results.length) {
      clearTimeout(searchTimer);
      await search(q);
    }
    if (results.length) choose(Math.max(active, 0));
  });

  el.suggestions.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); choose(+li.dataset.i); }
  });

  document.addEventListener('click', (e) => {
    if (!el.form.contains(e.target)) hideSuggestions();
  });

  /* ---------- 目前位置 ---------- */
  el.locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { showBanner('此瀏覽器不支援定位功能。'); return; }
    el.locateBtn.classList.add('spinning');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      let name = '目前位置', sub = '';
      try {
        const r = await getJSON(API.reverse, { latitude: lat, longitude: lon, localityLanguage: 'zh-Hant' });
        name = r.city || r.locality || r.principalSubdivision || name;
        sub = [r.principalSubdivision !== name ? r.principalSubdivision : '', r.countryName].filter(Boolean).join('，');
      } catch { /* 用預設名稱 */ }
      el.locateBtn.classList.remove('spinning');
      setPlace({ name, sub, lat, lon });
    }, (err) => {
      el.locateBtn.classList.remove('spinning');
      showBanner(err.code === 1 ? '定位權限被拒絕，請改用搜尋輸入地區。' : '無法取得目前位置，請改用搜尋輸入地區。');
    }, { timeout: 10000, maximumAge: 5 * 60 * 1000 });
  });

  /* ---------- 其他控制 ---------- */
  el.refreshBtn.addEventListener('click', () => { fetchAll(); scheduleRefresh(); });

  document.querySelectorAll('.unit-toggle button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === state.unit);
    btn.addEventListener('click', () => {
      state.unit = btn.dataset.unit;
      save(STORE.unit, state.unit);
      document.querySelectorAll('.unit-toggle button').forEach((b) => b.classList.toggle('active', b === btn));
      render();
    });
  });

  // 分頁切回前景時，若資料過舊就立即更新
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastFetch > REFRESH_MS) fetchAll({ silent: true });
  });

  function showBanner(msg) { el.banner.textContent = msg; el.banner.hidden = false; }
  function hideBanner() { el.banner.hidden = true; }

  /* ---------- 啟動 ---------- */
  if (!state.recent.length) state.recent = [state.place];
  renderRecent();
  el.placeName.textContent = state.place.name;
  fetchAll();
  scheduleRefresh();
})();
