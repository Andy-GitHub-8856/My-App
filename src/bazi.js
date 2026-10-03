// 八字細節：十神、藏干、納音、十二長生、五行計分、強弱

export const GAN = '甲乙丙丁戊己庚辛壬癸';
export const ZHI = '子丑寅卯辰巳午未申酉戌亥';
export const WX = ['木', '火', '土', '金', '水'];

const GAN_WX = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
const ZHI_WX = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };
export const HIDDEN = {
  子: ['癸'], 丑: ['己', '癸', '辛'], 寅: ['甲', '丙', '戊'], 卯: ['乙'], 辰: ['戊', '乙', '癸'], 巳: ['丙', '庚', '戊'],
  午: ['丁', '己'], 未: ['己', '丁', '乙'], 申: ['庚', '壬', '戊'], 酉: ['辛'], 戌: ['戊', '辛', '丁'], 亥: ['壬', '甲'],
};
const NAYIN = ['海中金', '爐中火', '大林木', '路旁土', '劍鋒金', '山頭火', '澗下水', '城頭土', '白蠟金', '楊柳木',
  '泉中水', '屋上土', '霹靂火', '松柏木', '長流水', '沙中金', '山下火', '平地木', '壁上土', '金箔金',
  '覆燈火', '天河水', '大驛土', '釵釧金', '桑柘木', '大溪水', '沙中土', '天上火', '石榴木', '大海水'];
const CS12 = ['長生', '沐浴', '冠帶', '臨官', '帝旺', '衰', '病', '死', '墓', '絕', '胎', '養'];
const CS_START = { 甲: '亥', 丙: '寅', 戊: '寅', 庚: '巳', 壬: '申', 乙: '午', 丁: '酉', 己: '酉', 辛: '子', 癸: '卯' };

export const wxOfGan = (g) => GAN_WX[g];
export const wxOfZhi = (z) => ZHI_WX[z];
const yang = (g) => GAN.indexOf(g) % 2 === 0;
const wxIdx = (w) => WX.indexOf(w);

// 生我、我生…關係：0 同、1 我生、2 我剋、3 剋我、4 生我
const rel = (me, other) => (wxIdx(other) - wxIdx(me) + 5) % 5;

export function shiShen(dayGan, g) {
  const same = yang(dayGan) === yang(g);
  return [
    same ? '比肩' : '劫財', same ? '食神' : '傷官', same ? '偏財' : '正財',
    same ? '七殺' : '正官', same ? '偏印' : '正印',
  ][rel(GAN_WX[dayGan], GAN_WX[g])];
}

export function naYin(gz) {
  const gi = GAN.indexOf(gz[0]), zi = ZHI.indexOf(gz[1]);
  for (let i = 0; i < 60; i++) if (i % 10 === gi && i % 12 === zi) return NAYIN[Math.floor(i / 2)];
  return '';
}

export function changSheng(gan, zhi) {
  const start = ZHI.indexOf(CS_START[gan]), z = ZHI.indexOf(zhi);
  const step = yang(gan) ? (z - start + 12) % 12 : (start - z + 12) % 12;
  return CS12[step];
}

// pillars: { year, month, day, hour? } 每柱為兩字干支
export function analyze(pillars) {
  const dayGan = pillars.day[0];
  const keys = ['year', 'month', 'day', 'hour'].filter((k) => pillars[k]);
  const cols = keys.map((k) => {
    const gz = pillars[k];
    const [g, z] = gz;
    return {
      key: k, label: { year: '年柱', month: '月柱', day: '日柱', hour: '時柱' }[k], gz, gan: g, zhi: z,
      ganWx: GAN_WX[g], zhiWx: ZHI_WX[z],
      ganShiShen: k === 'day' ? '日主' : shiShen(dayGan, g),
      hidden: HIDDEN[z].map((h) => ({ gan: h, wx: GAN_WX[h], shiShen: shiShen(dayGan, h) })),
      naYin: naYin(gz), changSheng: changSheng(dayGan, z),
    };
  });

  // 五行計分
  const score = Object.fromEntries(WX.map((w) => [w, 0]));
  const HW = [1, 0.5, 0.3];
  for (const c of cols) {
    score[c.ganWx] += 1;
    const mul = c.key === 'month' ? 2 : 1;
    HIDDEN[c.zhi].forEach((h, i) => { score[GAN_WX[h]] += HW[i] * mul; });
  }
  const total = WX.reduce((s, w) => s + score[w], 0);
  const me = GAN_WX[dayGan];
  const resource = WX[(wxIdx(me) + 4) % 5];
  const support = score[me] + score[resource];
  const ratio = support / total;
  const strength = ratio >= 0.55 ? '身強' : ratio <= 0.42 ? '身弱' : '中和';
  const output = WX[(wxIdx(me) + 1) % 5], wealth = WX[(wxIdx(me) + 2) % 5], officer = WX[(wxIdx(me) + 3) % 5];
  const favorable = strength === '身強' ? [output, wealth, officer] : strength === '身弱' ? [resource, me] : [];
  const unfavorable = strength === '身強' ? [resource, me] : strength === '身弱' ? [officer, wealth, output] : [];

  const counts = Object.fromEntries(WX.map((w) => [w, 0]));
  for (const c of cols) { counts[c.ganWx]++; counts[c.zhiWx]++; }

  return {
    dayGan, dayWx: me, cols,
    score: Object.fromEntries(WX.map((w) => [w, Math.round(score[w] * 10) / 10])),
    percent: Object.fromEntries(WX.map((w) => [w, Math.round((score[w] / total) * 1000) / 10])),
    counts, missing: WX.filter((w) => counts[w] === 0),
    supportRatio: Math.round(ratio * 1000) / 10, strength, favorable, unfavorable,
  };
}
