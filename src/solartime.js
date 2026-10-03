// 真太陽時、夏令時與出生地資料

export const CITIES = [
  { group: '台灣', items: [
    ['台北', 121.56], ['新北', 121.46], ['基隆', 121.74], ['桃園', 121.30], ['新竹', 120.97],
    ['苗栗', 120.82], ['台中', 120.68], ['彰化', 120.54], ['南投', 120.69], ['雲林', 120.53],
    ['嘉義', 120.45], ['台南', 120.21], ['高雄', 120.31], ['屏東', 120.49], ['宜蘭', 121.75],
    ['花蓮', 121.60], ['台東', 121.15], ['澎湖', 119.57], ['金門', 118.32], ['馬祖', 119.95],
  ].map(([n, lon]) => ({ name: n, lon, tz: 8, dst: 'TW' })) },
  { group: '港澳', items: [
    { name: '香港', lon: 114.17, tz: 8, dst: '' }, { name: '澳門', lon: 113.55, tz: 8, dst: '' },
  ] },
  { group: '中國', items: [
    ['北京', 116.41], ['上海', 121.47], ['廣州', 113.26], ['深圳', 114.06], ['福州', 119.30],
    ['廈門', 118.09], ['杭州', 120.15], ['南京', 118.80], ['武漢', 114.31], ['成都', 104.07],
    ['重慶', 106.55], ['西安', 108.94], ['瀋陽', 123.43], ['哈爾濱', 126.63], ['昆明', 102.71],
    ['烏魯木齊', 87.62],
  ].map(([n, lon]) => ({ name: n, lon, tz: 8, dst: 'CN' })) },
  { group: '海外', items: [
    { name: '新加坡', lon: 103.82, tz: 8 }, { name: '吉隆坡', lon: 101.69, tz: 8 },
    { name: '東京', lon: 139.69, tz: 9 }, { name: '首爾', lon: 126.98, tz: 9 },
    { name: '曼谷', lon: 100.50, tz: 7 }, { name: '雪梨', lon: 151.21, tz: 10 },
    { name: '倫敦', lon: -0.13, tz: 0 }, { name: '巴黎', lon: 2.35, tz: 1 },
    { name: '紐約', lon: -74.01, tz: -5 }, { name: '洛杉磯', lon: -118.24, tz: -8 },
    { name: '溫哥華', lon: -123.12, tz: -8 },
  ].map((c) => ({ dst: '', ...c })) },
];

export function findCity(name) {
  for (const g of CITIES) for (const c of g.items) if (c.name === name) return c;
  return null;
}

// 夏令時實施期間（含首尾日）
const DST = {
  TW: [
    ['1945-05-01', '1945-09-30'], ['1946-05-15', '1946-09-30'], ['1947-04-15', '1947-10-31'],
    ['1948-05-01', '1948-09-30'], ['1949-05-01', '1949-09-30'], ['1950-05-01', '1950-09-30'],
    ['1951-05-01', '1951-09-30'], ['1952-03-01', '1952-10-31'], ['1953-04-01', '1953-10-31'],
    ['1954-04-01', '1954-10-31'], ['1955-04-01', '1955-09-30'], ['1956-04-01', '1956-09-30'],
    ['1957-04-01', '1957-09-30'], ['1958-04-01', '1958-09-30'], ['1959-04-01', '1959-09-30'],
    ['1960-06-01', '1960-09-30'], ['1961-06-01', '1961-09-30'], ['1974-04-01', '1974-09-30'],
    ['1975-04-01', '1975-09-30'], ['1979-07-01', '1979-09-30'],
  ],
  CN: [
    ['1986-05-04', '1986-09-14'], ['1987-04-12', '1987-09-13'], ['1988-04-17', '1988-09-11'],
    ['1989-04-16', '1989-09-17'], ['1990-04-15', '1990-09-16'], ['1991-04-14', '1991-09-15'],
  ],
};

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function isDst(region, y, m, d) {
  const list = DST[region];
  if (!list) return false;
  const s = ymd(y, m, d);
  return list.some(([a, b]) => s >= a && s <= b);
}

// 均時差（分鐘），N = 年中第幾天
export function equationOfTime(y, m, d) {
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const b = (2 * Math.PI * (n - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

// 回傳校正後的國曆時間與各項修正量（分鐘）
export function correctTime({ y, m, d, h, mi }, { lon, tz, dst, trueSolar }) {
  const dstMin = dst ? -60 : 0;
  const lonMin = trueSolar ? (lon - tz * 15) * 4 : 0;
  const eotMin = trueSolar ? equationOfTime(y, m, d) : 0;
  const total = dstMin + lonMin + eotMin;
  const t = new Date(Date.UTC(y, m - 1, d, h, mi) + Math.round(total) * 60000);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    h: t.getUTCHours(), mi: t.getUTCMinutes(),
    dstMin, lonMin: Math.round(lonMin * 10) / 10, eotMin: Math.round(eotMin * 10) / 10,
    totalMin: Math.round(total),
  };
}

export const fmtTime = (t) => `${t.y}-${pad(t.m)}-${pad(t.d)} ${pad(t.h)}:${pad(t.mi)}`;
