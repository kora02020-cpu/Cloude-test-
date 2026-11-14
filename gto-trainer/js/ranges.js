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

    { id: 'BTN_vs_CO', group: 'オープンに対する対応', labels: { raise: '3ベット' }, name: 'BTN vs CO オープン', actions: ['raise', 'call', 'fold'],
      raise: 'TT+, 99:0.3, AQs+, AKo, AJs:0.6, ATs:0.3, KQs:0.6, KJs:0.3, A5s-A3s:0.6, K9s:0.4, QJs:0.3, JTs:0.3, T9s:0.2, 65s:0.3, 54s:0.3, AQo:0.6, AJo:0.2, KJo:0.2, KQo:0.3',
      cont: '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, 54s:0.4, ATo+, KJo+, QJo:0.5' },
    { id: 'SB_vs_BTN', group: 'オープンに対する対応', labels: { raise: '3ベット' }, name: 'SB vs BTN オープン', actions: ['raise', 'call', 'fold'],
      raise: '77+, 66:0.5, A8s+, A5s-A3s, KTs+, QTs+, JTs, T9s:0.5, 98s:0.5, AJo+, KQo, ATo:0.5, KJo:0.5, K9s:0.4',
      cont: '66+, 55:0.6, 44:0.4, A7s+, A5s-A3s, A6s:0.5, K9s+, QTs+, JTs, T9s, 98s, 87s:0.4, AJo+, KQo, ATo:0.6, KJo:0.6' },
    { id: 'BB_vs_BTN', group: 'オープンに対する対応', labels: { raise: '3ベット' }, name: 'BB vs BTN オープン', actions: ['raise', 'call', 'fold'],
      raise: 'QQ+, JJ:0.7, TT:0.4, 99:0.2, AKs, AKo, AQs:0.7, AJs:0.5, ATs:0.3, KQs:0.5, KJs:0.4, KTs:0.4, AQo:0.5, AJo:0.3, A5s-A2s:0.6, K9s:0.5, K8s:0.3, Q9s:0.5, QTs:0.3, J9s:0.5, T8s:0.5, 97s:0.5, 86s:0.4, 76s:0.5, 65s:0.5, 54s:0.4, KJo:0.3, KQo:0.3, A9o:0.3, QJo:0.2, A8o:0.2',
      cont: '22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, J3s:0.5, T5s:0.5, A2o+, K5o+, Q8o+, J8o+, T8o+, 98o, 87o:0.7, 76o:0.5, K2o:0.4, K3o:0.4, K4o:0.5, Q7o:0.5, J7o:0.4, T7o:0.4, 97o:0.5' },
    { id: 'BB_vs_SB', group: 'オープンに対する対応', labels: { raise: '3ベット' }, name: 'BB vs SB オープン (3x)', actions: ['raise', 'call', 'fold'],
      raise: 'TT+, A9s+, KTs+, QJs, A5s-A2s:0.5, AJo+, KQo, 76s:0.3, 65s:0.3, K9o:0.2, 99:0.5',
      cont: '22+, A2s+, K2s+, Q2s+, J3s+, T5s+, 95s+, 84s+, 74s+, 63s+, 52s+, 42s+, A2o+, K2o+, Q5o+, J7o+, T7o+, 97o+, 87o, 76o, 65o:0.5, Q2o:0.4, Q3o:0.4, Q4o:0.4' },
    // ---- 3ベットに対する対応（オープナー側）: 到達レンジ = 自分のオープンレンジ ----
    { id: 'UTG_vs_BTN3b', group: '3ベットに対する対応', name: 'UTG オープン vs BTN 3ベット', prior: 'UTG_RFI',
      desc: 'UTG 2.5bb オープン → BTN 3ベット 7.5bb（OOP）', labels: { raise: '4ベット' }, actions: ['raise', 'call', 'fold'],
      raise: 'KK+, AKs, QQ:0.4, AKo:0.6, A5s:0.4, A4s:0.3',
      cont: 'QQ+, JJ, TT, 99:0.6, 88:0.4, 77:0.3, AKs, AQs, AJs, KQs, ATs:0.5, KJs:0.5, QJs:0.4, JTs:0.4, AKo, AQo:0.5, A5s:0.4, A4s:0.3' },
    { id: 'CO_vs_BTN3b', group: '3ベットに対する対応', name: 'CO オープン vs BTN 3ベット', prior: 'CO_RFI',
      desc: 'CO 2.5bb オープン → BTN 3ベット 7.5bb（OOP）', labels: { raise: '4ベット' }, actions: ['raise', 'call', 'fold'],
      raise: 'QQ+, AKs, JJ:0.3, AKo:0.7, A5s:0.5, A4s:0.4, KJs:0.2, AJo:0.15',
      cont: 'QQ+, JJ, TT, 99, 88:0.6, 77:0.4, 66:0.2, AKs, AQs, AJs, ATs, A5s, A4s:0.4, KQs, KJs, KTs:0.5, QJs, QTs:0.5, JTs, T9s:0.6, 98s:0.4, AKo, AQo, AJo:0.4, KQo:0.3' },
    { id: 'BTN_vs_BB3b', group: '3ベットに対する対応', name: 'BTN オープン vs BB 3ベット', prior: 'BTN_RFI',
      desc: 'BTN 2.5bb オープン → BB 3ベット 11bb（IP）', labels: { raise: '4ベット' }, actions: ['raise', 'call', 'fold'],
      raise: 'KK+, QQ:0.6, AKs, AKo, AQs:0.3, A5s-A4s:0.4, A3s:0.2, K9s:0.1, ATo:0.1',
      cont: '22+, 33:0.6, 22:0.5, A2s+, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, 54s:0.5, AJo+, KQo, ATo:0.5, KJo:0.5, QJo:0.3, A9o:0.2' },
    { id: 'SB_vs_BB3b', group: '3ベットに対する対応', name: 'SB オープン vs BB 3ベット', prior: 'SB_RFI',
      desc: 'SB 3bb オープン → BB 3ベット 9bb（OOP）', labels: { raise: '4ベット' }, actions: ['raise', 'call', 'fold'],
      raise: 'QQ+, AKs, AKo, JJ:0.3, A5s:0.5, A4s:0.4, AQs:0.3, K9s:0.15',
      cont: '22+, 33:0.5, 22:0.4, A8s+, A5s-A3s, A7s:0.5, KTs+, QTs+, JTs, T9s, 98s:0.6, 87s:0.4, 76s:0.3, AJo+, KQo, ATo:0.4, KJo:0.3' },

    // ---- 4ベットに対する対応（3ベッター側）: 到達レンジ = 自分の3ベットレンジ ----
    { id: 'BTN3b_vs_CO4b', group: '4ベットに対する対応', name: 'BTN 3ベット vs CO 4ベット', prior: 'BTN_vs_CO',
      desc: 'CO オープン → BTN 3ベット 7.5bb → CO 4ベット 19bb（IP）', labels: { raise: '5ベット(オールイン)' }, actions: ['raise', 'call', 'fold'],
      raise: 'KK+, AKs, QQ:0.4, AKo:0.6, A5s:0.2',
      cont: 'KK+, QQ, JJ:0.7, TT:0.3, AKs, AQs:0.6, AKo, KQs:0.2, A5s:0.4' },
    { id: 'SB3b_vs_BTN4b', group: '4ベットに対する対応', name: 'SB 3ベット vs BTN 4ベット', prior: 'SB_vs_BTN',
      desc: 'BTN オープン → SB 3ベット 11bb → BTN 4ベット 24bb（OOP）', labels: { raise: '5ベット(オールイン)' }, actions: ['raise', 'call', 'fold'],
      raise: 'QQ+, AKs, AKo:0.7, JJ:0.2, A5s:0.3',
      cont: 'QQ+, JJ, TT:0.5, AKs, AQs, AJs:0.3, KQs:0.3, AKo, AQo:0.2, A5s:0.4' },
    { id: 'BB3b_vs_BTN4b', group: '4ベットに対する対応', name: 'BB 3ベット vs BTN 4ベット', prior: 'BB_vs_BTN',
      desc: 'BTN オープン → BB 3ベット 11bb → BTN 4ベット 24bb（OOP）', labels: { raise: '5ベット(オールイン)' }, actions: ['raise', 'call', 'fold'],
      raise: 'QQ+, AKs, AKo:0.8, JJ:0.3, A5s:0.3',
      cont: 'QQ+, JJ, TT:0.8, 99:0.4, AKs, AQs, AJs:0.4, KQs:0.5, KJs:0.3, AKo, AQo:0.3, A5s:0.6, A4s:0.4' },
    // ---- プッシュ/フォールド: 戦略は pushfold.js がスタックごとにナッシュ均衡を計算して書き込む ----
    { id: 'SB_PF', group: 'プッシュ/フォールド (ナッシュ均衡を計算)', name: 'SB オールイン or フォールド (HU)', pushfold: 'sb',
      labels: { raise: 'オールイン' }, actions: ['raise', 'fold'], raise: '' },
    { id: 'BB_vs_SB_PF', group: 'プッシュ/フォールド (ナッシュ均衡を計算)', name: 'BB vs SB オールイン (HU)', pushfold: 'bb',
      actions: ['call', 'fold'], raise: '', cont: '' },
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
  // 到達頻度: 前のアクションでこのスポットに来るハンドの割合（例: 4ベットに直面＝自分が3ベットしたハンドのみ）
  const byId = id => SCENARIOS.find(s => s.id === id);
  for (const sc of SCENARIOS) {
    sc.reach = {};
    const prev = sc.prior && byId(sc.prior);
    for (const h of ALL_HANDS) sc.reach[h] = prev ? prev.strategy[h].raise : 1;
  }

  function rangeStats(sc) {
    let total = 0, raise = 0, call = 0;
    for (const h of ALL_HANDS) {
      const n = combosOf(h) * sc.reach[h], s = sc.strategy[h];
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
