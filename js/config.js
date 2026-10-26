// アプリ全体の設定値。数値の変更はここだけで済むようにしている。

// 日次ノルマ(件)
export const QUOTA = { effective: 2, cold: 2 };

// 給料日。支出の集計期間は (PAYDAY + 1) 日 〜 翌月 PAYDAY 日
export const PAYDAY = 25;

// 受注ポイントの月目標が未設定のときの既定値
export const DEFAULT_MONTHLY_GOAL = 200;

// 推移グラフに並べる期の数(今期を含む)
export const TREND_CYCLES = 6;

export const COLORS = {
  blue: '#4d9bff',
  green: '#3ddc97',
  muted: '#8b95a5',
  text: '#e8ecf2',
  track: '#2a313c',
  idle: '#3a4453',
};

export const CATEGORIES = [
  { id: '固定費', color: '#4d9bff' },
  { id: 'カード', color: '#ff8a4c' },
  { id: '交通費', color: '#3ddc97' },
  { id: '食費', color: '#f2c14e' },
  { id: '趣味', color: '#e87ba4' },
];

// 歩合表(完了ポイント → 歩合)。points の昇順で並べる
export const COMMISSION_TIERS = (() => {
  const tiers = [
    { points: 150, yen: 10000 },
    { points: 180, yen: 13000 },
    { points: 200, yen: 24000 },
    { points: 250, yen: 30000 },
  ];
  for (let p = 300; p <= 3000; p += 50) tiers.push({ points: p, yen: p * 140 });
  return tiers;
})();

// 同期先。両方とも空なら同期なし(端末内のみ)で動く。手順は README を参照
export const SYNC = {
  supabaseUrl: '',
  supabaseKey: '',
};
