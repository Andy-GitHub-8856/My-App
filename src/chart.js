// 整合排盤：輸入 → 校正時間 → 紫微 / 八字 / 稱骨

import { astro } from 'iztro';
import { Solar, Lunar, LunarYear } from 'lunar-javascript';
import { correctTime, fmtTime } from './solartime.js';
import { analyze, ZHI } from './bazi.js';
import { chengGu } from './chenggu.js';

const pn = (n) => (n.endsWith('宮') ? n : n + '宮');
const TIME_NAMES = ['早子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '晚子'];

function addDays(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

export function buildChart(input, now = new Date()) {
  const warnings = [];
  let { y, m, d } = input;
  const h = input.hourUnknown ? 12 : input.h;
  const mi = input.hourUnknown ? 0 : input.mi;

  // 1. 農曆轉國曆
  if (input.calendar === 'lunar') {
    if (input.leap && LunarYear.fromYear(y).getLeapMonth() !== m) {
      throw new Error(`農曆 ${y} 年沒有閏 ${m} 月，請確認。`);
    }
    let s;
    try { s = Lunar.fromYmd(y, input.leap ? -m : m, d).getSolar(); } catch {
      throw new Error(`農曆 ${y} 年${input.leap ? '閏' : ''}${m} 月沒有 ${d} 日（該月可能只有 29 天）。`);
    }
    [y, m, d] = [s.getYear(), s.getMonth(), s.getDay()];
  }
  const birthSolar = { y, m, d, h, mi };

  // 2. 時間校正
  const ct = input.hourUnknown
    ? { ...birthSolar, dstMin: 0, lonMin: 0, eotMin: 0, totalMin: 0 }
    : correctTime(birthSolar, { lon: input.lon, tz: input.tz, dst: input.dst, trueSolar: input.trueSolar });

  // 3. 時辰
  let date = [ct.y, ct.m, ct.d];
  let timeIndex = null, hourZhi = null;
  const lateZi = !input.hourUnknown && ct.h === 23;
  if (!input.hourUnknown) {
    hourZhi = ZHI[Math.floor((ct.h + 1) / 2) % 12];
    timeIndex = ct.h === 0 ? 0 : ct.h === 23 ? 12 : Math.floor((ct.h + 1) / 2);
    if (lateZi && input.ziMode === 'next') { date = addDays(...date, 1); timeIndex = 0; }
  }

  // 4. 八字（lunar-javascript）
  const solarExact = Solar.fromYmdHms(ct.y, ct.m, ct.d, ct.h, ct.mi, 0);
  const lunarExact = solarExact.getLunar();
  const ec = lunarExact.getEightChar();
  ec.setSect(input.ziMode === 'next' ? 1 : 2);
  const pillars = { year: ec.getYear(), month: ec.getMonth(), day: ec.getDay() };
  if (!input.hourUnknown) pillars.hour = ec.getTime();
  const bazi = analyze(pillars);

  const yun = ec.getYun(input.gender === '男' ? 1 : 0);
  const thisYear = now.getFullYear();
  const dayun = yun.getDaYun(10).slice(1).map((dy) => ({
    gz: dy.getGanZhi(), startAge: dy.getStartAge(), endAge: dy.getEndAge(),
    startYear: dy.getStartYear(), endYear: dy.getEndYear(),
    current: thisYear >= dy.getStartYear() && thisYear <= dy.getEndYear(),
  }));
  bazi.yun = {
    start: `${yun.getStartYear()} 年 ${yun.getStartMonth()} 個月 ${yun.getStartDay()} 天起運`,
    forward: yun.isForward ? yun.isForward() : undefined,
    list: dayun,
  };
  bazi.taiYuan = ec.getTaiYuan();
  bazi.mingGong = ec.getMingGong();

  // 農曆日期（稱骨、顯示用）；「23 點換日」時以隔日計
  const lunarForDate = (lateZi && input.ziMode === 'next')
    ? Solar.fromYmdHms(...date, 0, 0, 0).getLunar() : lunarExact;
  const lunarInfo = {
    yearGz: lunarForDate.getYearInGanZhi(), month: Math.abs(lunarForDate.getMonth()),
    leap: lunarForDate.getMonth() < 0, day: lunarForDate.getDay(),
    text: `${lunarForDate.getYearInGanZhi()}年 ${lunarForDate.getMonth() < 0 ? '閏' : ''}${Math.abs(lunarForDate.getMonth())}月 ${lunarForDate.getDay()}日`,
    zodiac: '鼠牛虎兔龍蛇馬羊猴雞狗豬'[ZHI.indexOf(lunarForDate.getYearInGanZhi()[1])],
  };

  // 5. 稱骨
  const cg = chengGu(lunarInfo.yearGz, lunarInfo.month, lunarInfo.day, hourZhi);

  // 6. 紫微
  let ziwei = null;
  if (!input.hourUnknown) {
    const a = astro.bySolar(`${date[0]}-${date[1]}-${date[2]}`, timeIndex, input.gender, true, 'zh-TW');
    const hs = a.horoscope(now);
    const palaces = a.palaces.map((p) => ({
      index: p.index, name: p.name, stem: p.heavenlyStem, branch: p.earthlyBranch,
      isBody: p.isBodyPalace,
      major: p.majorStars.map((s) => ({ name: s.name, b: s.brightness || '', mu: s.mutagen || '' })),
      minor: p.minorStars.map((s) => ({ name: s.name, b: s.brightness || '', mu: s.mutagen || '' })),
      adj: p.adjectiveStars.map((s) => s.name),
      cs12: p.changsheng12, boshi: p.boshi12,
      decadal: p.decadal.range,
      isDecadal: p.index === hs.decadal.index,
      isYearly: p.index === hs.yearly.index,
    }));
    ziwei = {
      solarDate: a.solarDate, lunarDate: a.lunarDate, chineseDate: a.chineseDate,
      time: a.time, timeRange: a.timeRange, sign: a.sign, zodiac: a.zodiac,
      soulBranch: a.earthlyBranchOfSoulPalace, bodyBranch: a.earthlyBranchOfBodyPalace,
      soul: a.soul, body: a.body, fiveElementsClass: a.fiveElementsClass, palaces,
      horoscope: {
        nominalAge: hs.age.nominalAge,
        decadal: { stem: hs.decadal.heavenlyStem, branch: hs.decadal.earthlyBranch, mutagen: hs.decadal.mutagen,
          palace: palaces[hs.decadal.index]?.name },
        yearly: { stem: hs.yearly.heavenlyStem, branch: hs.yearly.earthlyBranch, mutagen: hs.yearly.mutagen,
          palace: palaces[hs.yearly.index]?.name },
        age: { branch: hs.age.earthlyBranch, palace: palaces[hs.age.index]?.name },
      },
    };
  } else {
    warnings.push('時辰不詳：紫微斗數需要出生時辰才能排盤，本次僅提供八字三柱與稱骨三項。');
  }

  if (lateZi) warnings.push(`校正後落在 23 點（子時），已依「${input.ziMode === 'next' ? '23 點即換日' : '早晚子時分日'}」處理。`);
  if (!input.hourUnknown && ct.totalMin && Math.abs(ct.totalMin) >= 1) {
    const before = ZHI[Math.floor((h + 1) / 2) % 12];
    if (before !== hourZhi) warnings.push(`注意：校正前為${before}時，校正後為${hourZhi}時，時辰已改變。`);
  }

  return {
    version: 1,
    input,
    createdAt: new Date().toISOString(),
    birthSolar, corrected: ct,
    correctedText: fmtTime(ct),
    timeName: timeIndex == null ? '不詳' : TIME_NAMES[timeIndex] + '時',
    hourZhi, lunar: lunarInfo, bazi, chenggu: cg, ziwei, warnings,
    referenceDate: now.toISOString().slice(0, 10),
  };
}

// 給 AI 的精簡命盤文字
export function chartToPrompt(c) {
  const i = c.input;
  const lines = [];
  lines.push('【基本資料】');
  lines.push(`姓名：${i.name}；性別：${i.gender}；出生地：${i.place}`);
  lines.push(`輸入時間：${i.calendar === 'lunar' ? '農曆' : '國曆'} ${i.y}-${i.m}-${i.d}${i.leap ? '（閏月）' : ''} ${i.hourUnknown ? '時辰不詳' : `${i.h}:${String(i.mi).padStart(2, '0')}`}`);
  if (!i.hourUnknown) lines.push(`校正後國曆：${c.correctedText}（夏令 ${c.corrected.dstMin} 分、經度 ${c.corrected.lonMin} 分、均時差 ${c.corrected.eotMin} 分）`);
  lines.push(`農曆：${c.lunar.text}；生肖：${c.lunar.zodiac}；時辰：${c.timeName}`);
  lines.push(`今天日期：${c.referenceDate}`);
  if (i.focus) lines.push(`命主特別想了解：${i.focus}`);

  const b = c.bazi;
  lines.push('', '【八字】');
  lines.push(b.cols.map((col) => `${col.label} ${col.gz}（干:${col.ganShiShen}；支藏:${col.hidden.map((h) => h.gan + h.shiShen).join('、')}；納音:${col.naYin}；長生:${col.changSheng}）`).join('\n'));
  lines.push(`日主：${b.dayGan}${b.dayWx}；五行分數：${Object.entries(b.score).map(([k, v]) => `${k}${v}`).join(' ')}；五行字數：${Object.entries(b.counts).map(([k, v]) => `${k}${v}`).join(' ')}${b.missing.length ? '；缺：' + b.missing.join('') : ''}`);
  lines.push(`同類（比劫+印）比例：${b.supportRatio}%，程式初判：${b.strength}；初判喜用：${b.favorable.join('') || '需綜合判斷'}；忌：${b.unfavorable.join('') || '需綜合判斷'}（此為簡化計分，請結合月令、格局、調候自行判斷）`);
  lines.push(`胎元：${b.taiYuan}；命宮：${b.mingGong}；${b.yun.start}`);
  lines.push('大運：' + b.yun.list.map((d) => `${d.gz}(${d.startAge}-${d.endAge}歲,${d.startYear}-${d.endYear}${d.current ? ',目前' : ''})`).join('、'));

  const g = c.chenggu;
  lines.push('', '【稱骨】');
  lines.push(`${g.parts.map((p) => p.label + p.text).join(' + ')} = ${g.text}${g.complete ? '' : '（缺時辰，不完整）'}`);
  if (g.song) lines.push(`稱骨歌：${g.song}`);

  const z = c.ziwei;
  if (z) {
    lines.push('', '【紫微斗數（三合派，iztro 排盤）】');
    lines.push(`五行局：${z.fiveElementsClass}；命主：${z.soul}；身主：${z.body}；命宮在${z.soulBranch}；身宮在${z.bodyBranch}`);
    for (const p of z.palaces) {
      const star = (s) => `${s.name}${s.b ? '(' + s.b + ')' : ''}${s.mu ? '[化' + s.mu + ']' : ''}`;
      lines.push(`${pn(p.name)} ${p.stem}${p.branch}${p.isBody ? '［身宮］' : ''}：主星 ${p.major.map(star).join('、') || '無（空宮）'}；輔星 ${p.minor.map(star).join('、') || '無'}；雜曜 ${p.adj.join('、') || '無'}；長生 ${p.cs12}；大限 ${p.decadal[0]}-${p.decadal[1]} 歲`);
    }
    const hs = z.horoscope;
    lines.push(`目前虛歲 ${hs.nominalAge}；目前大限 ${hs.decadal.stem}${hs.decadal.branch}（落本命${pn(hs.decadal.palace)}），大限四化 祿${hs.decadal.mutagen[0]} 權${hs.decadal.mutagen[1]} 科${hs.decadal.mutagen[2]} 忌${hs.decadal.mutagen[3]}`);
    lines.push(`今年流年 ${hs.yearly.stem}${hs.yearly.branch}（流年命宮落本命${pn(hs.yearly.palace)}），流年四化 祿${hs.yearly.mutagen[0]} 權${hs.yearly.mutagen[1]} 科${hs.yearly.mutagen[2]} 忌${hs.yearly.mutagen[3]}；小限在${pn(hs.age.palace)}`);
  }
  return lines.join('\n');
}
