// 命盤、八字、稱骨畫面

import { ZHI } from './bazi.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const WX_CLASS = { 木: 'wx-mu', 火: 'wx-huo', 土: 'wx-tu', 金: 'wx-jin', 水: 'wx-shui' };
const MU_CLASS = { 祿: 'mu-lu', 權: 'mu-quan', 科: 'mu-ke', 忌: 'mu-ji' };
const POS = { 巳: [1, 1], 午: [1, 2], 未: [1, 3], 申: [1, 4], 辰: [2, 1], 酉: [2, 4], 卯: [3, 1], 戌: [3, 4], 寅: [4, 1], 丑: [4, 2], 子: [4, 3], 亥: [4, 4] };
const pn = (n) => (n.endsWith('宮') ? n : n + '宮');

const star = (s, cls) => `<span class="star ${cls}">${esc(s.name)}${s.b ? `<i class="br">${esc(s.b)}</i>` : ''}${s.mu ? `<b class="mu ${MU_CLASS[s.mu]}">${s.mu}</b>` : ''}</span>`;

export function renderZiwei(chart) {
  const z = chart.ziwei;
  if (!z) return `<div class="notice">⚠ 時辰不詳，無法排出紫微斗數命盤。請補上出生時間後重新排盤。</div>`;
  const cells = z.palaces.map((p) => {
    const [r, c] = POS[p.branch];
    const tags = [
      p.name === '命宮' ? '<span class="tag tag-soul">命</span>' : '',
      p.isBody ? '<span class="tag tag-body">身</span>' : '',
      p.isDecadal ? '<span class="tag tag-dec">大限</span>' : '',
      p.isYearly ? '<span class="tag tag-year">流年</span>' : '',
    ].join('');
    return `<div class="palace${p.name === '命宮' ? ' is-soul' : ''}${p.isDecadal ? ' is-dec' : ''}" style="grid-row:${r};grid-column:${c}" data-branch="${p.branch}">
      <div class="p-stars">
        <div class="p-major">${p.major.map((s) => star(s, 'major')).join('') || '<span class="star empty">空宮</span>'}</div>
        <div class="p-minor">${p.minor.map((s) => star(s, 'minor')).join('')}</div>
        <div class="p-adj">${p.adj.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
      </div>
      <div class="p-foot">
        <span class="p-cs">${esc(p.cs12)}<br>${esc(p.boshi)}</span>
        <span class="p-dec">${p.decadal[0]}–${p.decadal[1]}</span>
        <span class="p-name">${tags}<b>${esc(pn(p.name))}</b><em>${esc(p.stem + p.branch)}</em></span>
      </div>
    </div>`;
  }).join('');

  const b = chart.bazi;
  const hs = z.horoscope;
  const center = `<div class="center">
    <div class="c-title">${esc(chart.input.name)}</div>
    <div class="c-sub">${esc(chart.input.gender)}命 · ${esc(z.fiveElementsClass)} · 屬${esc(chart.lunar.zodiac)}</div>
    <div class="c-pillars">${b.cols.map((c) => `<div><span class="${WX_CLASS[c.ganWx]}">${c.gan}</span><span class="${WX_CLASS[c.zhiWx]}">${c.zhi}</span></div>`).join('')}</div>
    <dl class="c-info">
      <dt>國曆</dt><dd>${esc(chart.correctedText)}${chart.corrected.totalMin ? ' <small>(校正後)</small>' : ''}</dd>
      <dt>農曆</dt><dd>${esc(chart.lunar.text)} ${esc(chart.timeName)}</dd>
      <dt>命主</dt><dd>${esc(z.soul)}　<b>身主</b> ${esc(z.body)}</dd>
      <dt>大限</dt><dd>${esc(hs.decadal.stem + hs.decadal.branch)}（${esc(pn(hs.decadal.palace))}）</dd>
      <dt>流年</dt><dd>${esc(hs.yearly.stem + hs.yearly.branch)} 虛歲 ${hs.nominalAge}</dd>
    </dl>
    <div class="c-legend"><b class="mu mu-lu">祿</b><b class="mu mu-quan">權</b><b class="mu mu-ke">科</b><b class="mu mu-ji">忌</b> 點選宮位顯示三方四正</div>
  </div>`;
  return `<div class="ziwei-scroll"><div class="ziwei-grid">${cells}${center}</div></div>`;
}

export function bindZiwei(root) {
  root.querySelectorAll('.palace').forEach((el) => {
    el.addEventListener('click', () => {
      const bi = ZHI.indexOf(el.dataset.branch);
      const set = [0, 4, 6, 8].map((k) => ZHI[(bi + k) % 12]);
      const already = el.classList.contains('sel');
      root.querySelectorAll('.palace').forEach((p) => p.classList.remove('sel', 'tri', 'opp'));
      if (already) return;
      el.classList.add('sel');
      root.querySelectorAll('.palace').forEach((p) => {
        const k = set.indexOf(p.dataset.branch);
        if (k === 2) p.classList.add('opp'); else if (k > 0) p.classList.add('tri');
      });
    });
  });
}

export function renderBazi(chart) {
  const b = chart.bazi;
  const order = [...b.cols].reverse(); // 傳統由右至左：時日月年
  const row = (label, fn) => `<tr><th>${label}</th>${order.map((c) => `<td>${fn(c)}</td>`).join('')}</tr>`;
  const table = `<div class="tbl"><table class="pillars">
    <thead><tr><th></th>${order.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead>
    <tbody>
      ${row('十神', (c) => `<span class="ss">${c.ganShiShen}</span>`)}
      ${row('天干', (c) => `<span class="big ${WX_CLASS[c.ganWx]}">${c.gan}</span><small>${c.ganWx}</small>`)}
      ${row('地支', (c) => `<span class="big ${WX_CLASS[c.zhiWx]}">${c.zhi}</span><small>${c.zhiWx}</small>`)}
      ${row('藏干', (c) => c.hidden.map((h) => `<div class="hid"><span class="${WX_CLASS[h.wx]}">${h.gan}</span><small>${h.shiShen}</small></div>`).join(''))}
      ${row('納音', (c) => c.naYin)}
      ${row('長生', (c) => c.changSheng)}
    </tbody></table></div>`;

  const max = Math.max(...Object.values(b.score));
  const bars = Object.entries(b.score).map(([w, v]) => `<div class="bar-row">
      <span class="bar-label ${WX_CLASS[w]}">${w}</span>
      <div class="bar"><div class="bar-fill ${WX_CLASS[w]}-bg" style="width:${max ? (v / max) * 100 : 0}%"></div></div>
      <span class="bar-val">${v}<small> · ${b.percent[w]}%</small></span></div>`).join('');

  const gaugePos = Math.min(100, Math.max(0, b.supportRatio));
  const yun = b.yun.list.map((d) => `<div class="yun${d.current ? ' cur' : ''}">
      <div class="yun-gz"><span>${d.gz[0]}</span><span>${d.gz[1]}</span></div>
      <div class="yun-age">${d.startAge}–${d.endAge} 歲</div><div class="yun-yr">${d.startYear}</div></div>`).join('');

  return `${table}
  <div class="grid2">
    <div class="card-in"><h3>五行力量</h3>${bars}
      <p class="muted">五行字數：${Object.entries(b.counts).map(([k, v]) => `${k}${v}`).join('　')}${b.missing.length ? `　<b class="warn">缺${b.missing.join('')}</b>` : ''}</p></div>
    <div class="card-in"><h3>日主強弱</h3>
      <div class="daymaster"><span class="big ${WX_CLASS[b.dayWx]}">${b.dayGan}</span><div>日主 ${b.dayGan}${b.dayWx}<br><b class="gold">${b.strength}</b></div></div>
      <div class="gauge"><div class="gauge-mark" style="left:${gaugePos}%"></div><span>弱</span><span>中和</span><span>強</span></div>
      <p>同類力量（比劫＋印）：<b>${b.supportRatio}%</b></p>
      <p>初判喜用：<b class="gold">${b.favorable.join('、') || '需綜合判斷'}</b>　忌：${b.unfavorable.join('、') || '需綜合判斷'}</p>
      <p class="muted">胎元 ${b.taiYuan}　命宮 ${b.mingGong}<br>※ 簡化計分僅供參考，AI 解盤會綜合月令、格局與調候再判斷。</p>
    </div>
  </div>
  <div class="card-in"><h3>大運 <small class="muted">${esc(b.yun.start)}</small></h3><div class="yun-line">${yun}</div></div>`;
}

export function renderChenggu(chart) {
  const g = chart.chenggu;
  return `<div class="chenggu">
    <div class="scale" aria-hidden="true">
      <svg viewBox="0 0 200 140"><g class="scale-beam"><line x1="20" y1="40" x2="180" y2="40"/><circle cx="100" cy="40" r="5"/>
      <line x1="30" y1="40" x2="30" y2="90"/><path d="M10 90 Q30 108 50 90 Z"/><line x1="170" y1="40" x2="170" y2="70"/><circle cx="170" cy="78" r="8"/></g>
      <line x1="100" y1="40" x2="100" y2="130"/><line x1="70" y1="130" x2="130" y2="130"/></svg>
    </div>
    <div class="cg-total">${esc(g.text)}</div>
    <div class="cg-parts">${g.parts.map((p) => `<div><span>${esc(p.label)}</span><b>${esc(p.text)}</b></div>`).join('<i>＋</i>')}</div>
    ${g.song ? `<blockquote class="cg-song">${esc(g.song).split('，').join('，<br>')}</blockquote>` : '<p class="notice">時辰不詳，骨重缺少時辰一項，無法對應稱骨歌。</p>'}
    <p class="muted">袁天罡稱骨法以農曆年、月、日、時四項骨重相加，範圍為二兩一錢至七兩一錢。此為古代男命版本歌訣，僅供參考。</p>
  </div>`;
}
