// 7枚ハンド評価器 & モンテカルロ・エクイティ計算
// カード表現: 0..51  rank = c >> 2 (0='2' … 12='A'), suit = c & 3
(function (root) {
  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';

  function parseCard(str) {
    const r = RANKS.indexOf(str[0].toUpperCase());
    const s = SUITS.indexOf(str[1].toLowerCase());
    if (r < 0 || s < 0) throw new Error('不正なカード: ' + str);
    return (r << 2) | s;
  }

  function parseCards(str) {
    const clean = (str || '').replace(/[\s,]/g, '');
    if (clean.length % 2) throw new Error('カード表記が不正です: ' + str);
    const out = [];
    for (let i = 0; i < clean.length; i += 2) out.push(parseCard(clean.substr(i, 2)));
    if (new Set(out).size !== out.length) throw new Error('同じカードが重複しています');
    return out;
  }

  function cardToString(c) { return RANKS[c >> 2] + SUITS[c & 3]; }

  function straightHigh(mask) {
    const m = (mask << 1) | ((mask >> 12) & 1); // bit0 = A(ロー)
    for (let h = 13; h >= 4; h--) {
      if (((m >> (h - 4)) & 0x1f) === 0x1f) return h - 1;
    }
    return -1;
  }

  function topBits(mask, n) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
    return out;
  }

  function encode(cat, ks) {
    let v = cat;
    for (let i = 0; i < 5; i++) v = (v << 4) | (ks[i] || 0);
    return v;
  }

  // 値が大きいほど強い
  function eval7(cards) {
    const rc = new Array(13).fill(0);
    const sc = [0, 0, 0, 0];
    const sm = [0, 0, 0, 0];
    let rankMask = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i], r = c >> 2, s = c & 3;
      rc[r]++; sc[s]++; sm[s] |= 1 << r; rankMask |= 1 << r;
    }
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) flushSuit = s;
    if (flushSuit >= 0) {
      const sf = straightHigh(sm[flushSuit]);
      if (sf >= 0) return encode(8, [sf]);
    }
    let quad = -1; const trips = [], pairs = [], singles = [];
    for (let r = 12; r >= 0; r--) {
      if (rc[r] === 4) quad = r;
      else if (rc[r] === 3) trips.push(r);
      else if (rc[r] === 2) pairs.push(r);
      else if (rc[r] === 1) singles.push(r);
    }
    if (quad >= 0) {
      let k = -1;
      for (let r = 12; r >= 0; r--) if (r !== quad && rc[r]) { k = r; break; }
      return encode(7, [quad, k]);
    }
    if (trips.length && (trips.length > 1 || pairs.length)) {
      const second = trips.length > 1 ? Math.max(trips[1], pairs[0] ?? -1) : pairs[0];
      return encode(6, [trips[0], second]);
    }
    if (flushSuit >= 0) return encode(5, topBits(sm[flushSuit], 5));
    const st = straightHigh(rankMask);
    if (st >= 0) return encode(4, [st]);
    if (trips.length) return encode(3, [trips[0], singles[0], singles[1]]);
    if (pairs.length >= 2) {
      const k = Math.max(pairs[2] ?? -1, singles[0] ?? -1);
      return encode(2, [pairs[0], pairs[1], k]);
    }
    if (pairs.length === 1) return encode(1, [pairs[0], singles[0], singles[1], singles[2]]);
    return encode(0, singles.slice(0, 5));
  }

  const CATEGORY_NAMES = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート',
    'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ'];
  function category(v) { return CATEGORY_NAMES[v >> 20]; }

  // hero: [c,c]  villain: [[c,c,weight], ...] (コンボリスト)  board: [c..]
  function equity(hero, villainCombos, board, iterations) {
    const dead = new Set([...hero, ...board]);
    const combos = villainCombos.filter(v => !dead.has(v[0]) && !dead.has(v[1]) && v[2] > 0);
    if (!combos.length) throw new Error('相手のレンジに有効なコンボがありません');
    const cum = []; let total = 0;
    for (const v of combos) { total += v[2]; cum.push(total); }
    let win = 0, tie = 0, n = 0;
    const need = 5 - board.length;
    const deck = [];
    for (let iter = 0; iter < iterations; iter++) {
      const x = Math.random() * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > x) hi = mid; else lo = mid + 1; }
      const vc = combos[lo];
      deck.length = 0;
      for (let c = 0; c < 52; c++) if (!dead.has(c) && c !== vc[0] && c !== vc[1]) deck.push(c);
      const b = board.slice();
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(Math.random() * (deck.length - i));
        const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
        b.push(deck[i]);
      }
      const h = eval7([hero[0], hero[1], ...b]);
      const v = eval7([vc[0], vc[1], ...b]);
      if (h > v) win++; else if (h === v) tie++;
      n++;
    }
    return { win: win / n, tie: tie / n, lose: (n - win - tie) / n, equity: (win + tie / 2) / n, n };
  }

  const api = { RANKS, SUITS, parseCard, parseCards, cardToString, eval7, category, equity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Evaluator = api;
})(typeof window !== 'undefined' ? window : globalThis);
