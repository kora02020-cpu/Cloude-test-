// プリフロップ戦略データ（6-max / 100bb / 2.5x オープン想定の近似値）
// ※ ソルバー出力そのものではなく、一般的なGTO傾向を元にした学習用の近似レンジです。
(function (root) {
  const R = 'AKQJT98765432'; // グリッド用（強い順）

  // 13x13グリッドのハンド名
  function gridHand(i, j) {
    if (i === j) return R[i] + R[j];
    if (i < j) return R[i] + R[j] + 's';
    return R[j] + R[i] + 'o';
  }
  const ALL_HANDS = [];
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) ALL_HANDS.push(gridHand(i, j));

  function combosOf(h) { return h.length === 2 ? 6 : h[2] === 's' ? 4 : 12; }
  const ri = c => R.indexOf(c);

  // "22+, A2s+, A5s-A2s:0.5, KQo, AK" のような表記をパース → {hand: freq}
  function parseRange(str) {
    const out = {};
    if (!str) return out;
    for (let tok of str.split(',')) {
      tok = tok.trim();
      if (!tok) continue;
      let freq = 1;
      const m = tok.match(/^(.*):([\d.]+)$/);
      if (m) { tok = m[1].trim(); freq = parseFloat(m[2]); }
      for (const h of expandToken(tok)) out[h] = freq;
    }
    return out;
  }

  function expandToken(tok) {
    tok = tok.replace(/^(.)(.)/, (_, a, b) => a.toUpperCase() + b.toUpperCase());
    const res = [];
    let m;
    if ((m = tok.match(/^([2-9TJQKA])\1\+$/))) {           // TT+
      for (let k = ri(m[1]); k >= 0; k--) res.push(R[k] + R[k]);
    } else if ((m = tok.match(/^([2-9TJQKA])\1-([2-9TJQKA])\2$/))) { // 77-55
      const a = ri(m[1]), b = ri(m[2]);
      for (let k = Math.min(a, b); k <= Math.max(a, b); k++) res.push(R[k] + R[k]);
    } else if ((m = tok.match(/^([2-9TJQKA])\1$/))) {        // 77
      res.push(tok);
    } else if ((m = tok.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)\+$/))) { // A2s+
      const a = ri(m[1]), b = ri(m[2]);
      for (let k = b; k > a; k--) suffix(R[a] + R[k], m[3], res);
    } else if ((m = tok.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)-\1([2-9TJQKA])\3$/))) { // A5s-A2s
      const a = ri(m[1]), b = ri(m[2]), c = ri(m[4]);
      for (let k = Math.min(b, c); k <= Math.max(b, c); k++) suffix(R[a] + R[k], m[3], res);
    } else if ((m = tok.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)$/))) { // AKs / AK
      suffix(m[1] + m[2], m[3], res);
    } else {
      throw new Error('レンジ表記を解釈できません: ' + tok);
    }
    return res;
  }
  function suffix(base, s, res) {
    if (s) res.push(base + s); else { res.push(base + 's'); res.push(base + 'o'); }
  }

  // シナリオ定義: raise = レイズ頻度, cont = 参加（レイズ＋コール）頻度
  const SCENARIOS = [
    { id: 'UTG_RFI', group: 'オープン (RFI)', name: 'UTG オープン', actions: ['raise', 'fold'],
      raise: '55+, 44:0.5, 33:0.4, 22:0.4, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s:0.5, 76s:0.5, 65s:0.3, AJo+, KQo, ATo:0.5, KJo:0.5' },
    { id: 'HJ_RFI', group: 'オープン (RFI)', name: 'HJ オープン', actions: ['raise', 'fold'],
      raise: '22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s:0.6, 65s:0.5, ATo+, KJo+, QJo:0.5, A9o:0.3, KTo:0.3' },
    { id: 'CO_RFI', group: 'オープン (RFI)', name: 'CO オープン', actions: ['raise', 'fold'],
      raise: '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s:0.5, K4s:0.5, A8o+, A5o:0.5, KTo+, QTo+, JTo, K9o:0.3, A7o:0.3' },
    { id: 'BTN_RFI', group: 'オープン (RFI)', name: 'BTN オープン', actions: ['raise', 'fold'],
      raise: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s:0.5, Q3s:0.5, A2o+, K8o+, Q9o+, J9o+, T9o, K7o:0.5, Q8o:0.5, J8o:0.5, T8o:0.5, 98o:0.5, K6o:0.3' },
    { id: 'SB_RFI', group: 'オープン (RFI)', name: 'SB オープン (レイズ or フォールド)', actions: ['raise', 'fold'],
      raise: '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 97s+, 86s+, 75s+, 65s, 54s, A4o+, K9o+, QTo+, JTo, A2o:0.5, A3o:0.5, K8o:0.5, Q9o:0.5, T9o:0.5, Q4s:0.5' },

    { id: 'BTN_vs_CO', group: 'オープンに対する対応', name: 'BTN vs CO オープン', actions: ['raise', 'call', 'fold'],
      raise: 'TT+, AQs+, AKo, AJs:0.5, KQs:0.5, A5s-A4s:0.6, K9s:0.3, QJs:0.3, JTs:0.3, 65s:0.3, AQo:0.5, KJo:0.2',
      cont: '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, 54s:0.4, ATo+, KJo+, QJo:0.5' },
    { id: 'SB_vs_BTN', group: 'オープンに対する対応', name: 'SB vs BTN オープン', actions: ['raise', 'call', 'fold'],
      raise: '77+, 66:0.5, A8s+, A5s-A3s, KTs+, QTs+, JTs, T9s:0.5, 98s:0.5, AJo+, KQo, ATo:0.5, KJo:0.5, K9s:0.4',
      cont: '66+, 55:0.6, 44:0.4, A7s+, A5s-A3s, A6s:0.5, K9s+, QTs+, JTs, T9s, 98s, 87s:0.4, AJo+, KQo, ATo:0.6, KJo:0.6' },
    { id: 'BB_vs_BTN', group: 'オープンに対する対応', name: 'BB vs BTN オープン', actions: ['raise', 'call', 'fold'],
      raise: 'QQ+, JJ:0.7, AKs, AKo, AQs:0.5, A5s-A2s:0.5, K9s:0.3, Q9s:0.3, J9s:0.3, T8s:0.3, 97s:0.3, 76s:0.3, 65s:0.3, KJo:0.2, A9o:0.2',
      cont: '22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, J3s:0.5, T5s:0.5, A2o+, K5o+, Q8o+, J8o+, T8o+, 98o, 87o:0.7, 76o:0.5, K2o:0.4, K3o:0.4, K4o:0.5, Q7o:0.5, J7o:0.4, T7o:0.4, 97o:0.5' },
    { id: 'BB_vs_SB', group: 'オープンに対する対応', name: 'BB vs SB オープン (3x)', actions: ['raise', 'call', 'fold'],
      raise: 'TT+, A9s+, KTs+, QJs, A5s-A2s:0.5, AJo+, KQo, 76s:0.3, 65s:0.3, K9o:0.2, 99:0.5',
      cont: '22+, A2s+, K2s+, Q2s+, J3s+, T5s+, 95s+, 84s+, 74s+, 63s+, 52s+, 42s+, A2o+, K2o+, Q5o+, J7o+, T7o+, 97o+, 87o, 76o, 65o:0.5, Q2o:0.4, Q3o:0.4, Q4o:0.4' },
  ];

  // 各シナリオの {hand: {raise, call, fold}} を構築
  for (const sc of SCENARIOS) {
    const raise = parseRange(sc.raise);
    const cont = sc.cont ? parseRange(sc.cont) : raise;
    sc.strategy = {};
    for (const h of ALL_HANDS) {
      const r = raise[h] || 0;
      const c = sc.actions.includes('call') ? Math.max(0, Math.max(cont[h] || 0, r) - r) : 0;
      sc.strategy[h] = { raise: r, call: c, fold: Math.max(0, 1 - r - c) };
    }
  }

  function rangeStats(sc) {
    let total = 0, raise = 0, call = 0;
    for (const h of ALL_HANDS) {
      const n = combosOf(h), s = sc.strategy[h];
      total += n; raise += n * s.raise; call += n * s.call;
    }
    return { raise: raise / total, call: call / total, fold: 1 - (raise + call) / total };
  }

  // ハンド名 → 具体的なコンボ [[c1,c2], ...]  （evaluatorのカード表現）
  const ER = '23456789TJQKA';
  function handCombos(h) {
    const a = ER.indexOf(h[0]), b = ER.indexOf(h[1]), out = [];
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = 0; s2 < 4; s2++) {
      if (h.length === 2) { if (s2 > s1) out.push([(a << 2) | s1, (b << 2) | s2]); }
      else if (h[2] === 's') { if (s1 === s2) out.push([(a << 2) | s1, (b << 2) | s2]); }
      else if (s1 !== s2) out.push([(a << 2) | s1, (b << 2) | s2]);
    }
    return out;
  }

  const api = { R, gridHand, ALL_HANDS, combosOf, parseRange, SCENARIOS, rangeStats, handCombos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ranges = api;
})(typeof window !== 'undefined' ? window : globalThis);
