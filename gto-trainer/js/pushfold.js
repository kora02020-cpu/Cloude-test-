// ヘッズアップ プッシュ/フォールドのナッシュ均衡ソルバー
// ゲーム: 有効スタック S bb、SB 0.5bb / BB 1bb。SB はオールインかフォールド、BB はコールかフォールド。
// 169ハンド×169ハンドのオールインエクイティ表と、カードの重なりを考慮したコンボ数で
// 仮想プレイ（fictitious play）を回し、均衡戦略を求める。
(function (root) {
  const { ALL_HANDS, handCombos } = root.Ranges || require('./ranges.js');
  const EqData = root.PreflopEquity || require('./equity-data.js');
  const N = ALL_HANDS.length;
  let EQ = null, C = null;

  function init() {
    if (EQ) return;
    EQ = EqData.decode();
    C = new Float64Array(N * N); // 同時に配られうるコンボの組の数
    const combos = ALL_HANDS.map(handCombos);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      let n = 0;
      for (const a of combos[i]) for (const b of combos[j])
        if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) n++;
      C[i * N + j] = n;
    }
  }

  // SB: 各ハンドのオールインEV（フォールドは -0.5）
  function sbEV(S, Q) {
    const ev = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let num = 0, den = 0;
      for (let j = 0; j < N; j++) {
        const w = C[i * N + j]; if (!w) continue;
        const q = Q[j];
        num += w * ((1 - q) * 1 + q * (2 * S * EQ[i * N + j] - S));
        den += w;
      }
      ev[i] = num / den;
    }
    return ev;
  }
  // BB: 各ハンドのコールEV（フォールドは -1）。SB がそのハンドを持つときにオールインしてくる確率で重み付け
  function bbEV(S, P) {
    const ev = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      let num = 0, den = 0;
      for (let i = 0; i < N; i++) {
        const w = C[i * N + j] * P[i]; if (!w) continue;
        num += w * (2 * S * (1 - EQ[i * N + j]) - S);
        den += w;
      }
      ev[j] = den ? num / den : S; // 誰もオールインしてこないなら任意（コール扱い）
    }
    return ev;
  }

  const cache = new Map();
  function solve(S, iterations = 1500) {
    const key = S + ':' + iterations;
    if (cache.has(key)) return cache.get(key);
    init();
    const P = new Float64Array(N).fill(1), Q = new Float64Array(N).fill(0.5);
    for (let t = 1; t <= iterations; t++) {
      const a = 1 / (t + 1);
      const eb = bbEV(S, P);
      for (let j = 0; j < N; j++) Q[j] += ((eb[j] > -1 ? 1 : 0) - Q[j]) * a;
      const es = sbEV(S, Q);
      for (let i = 0; i < N; i++) P[i] += ((es[i] > -0.5 ? 1 : 0) - P[i]) * a;
    }
    // 端数をまとめる（仮想プレイの収束誤差による 0〜3% / 97〜100% のブレを除去）
    const snap = x => (x < 0.03 ? 0 : x > 0.97 ? 1 : Math.round(x * 100) / 100);
    for (let i = 0; i < N; i++) { P[i] = snap(P[i]); Q[i] = snap(Q[i]); }
    const evS = sbEV(S, Q), evB = bbEV(S, P);
    // 可搾取度: 相手の戦略を固定したとき、最善応答で増やせるEV（両者の平均, bb/ハンド）
    let gainS = 0, gainB = 0, wS = 0, wB = 0;
    const comb = h => (h.length === 2 ? 6 : h[2] === 's' ? 4 : 12);
    for (let i = 0; i < N; i++) {
      const n = comb(ALL_HANDS[i]);
      const cur = P[i] * evS[i] + (1 - P[i]) * -0.5;
      gainS += n * (Math.max(evS[i], -0.5) - cur); wS += n;
    }
    let shoveMass = 0;
    for (let j = 0; j < N; j++) {
      let m = 0; for (let i = 0; i < N; i++) m += C[i * N + j] * P[i];
      const cur = Q[j] * evB[j] + (1 - Q[j]) * -1;
      gainB += m * (Math.max(evB[j], -1) - cur); wB += C.slice(j * N, j * N + N).reduce((x, y) => x + y, 0);
      shoveMass += m;
    }
    const res = {
      S, P, Q, evS, evB,
      exploitability: (gainS / wS + gainB / wB) / 2,
    };
    cache.set(key, res);
    return res;
  }

  // Ranges のプッシュ/フォールド用シナリオに、指定スタックの均衡戦略を書き込む
  function setStack(S) {
    const r = solve(S);
    const SC = (root.Ranges || require('./ranges.js')).SCENARIOS;
    for (const sc of SC) {
      if (sc.pushfold === 'sb') {
        sc.strategy = {}; sc.reach = {}; sc.ev = {};
        ALL_HANDS.forEach((h, i) => {
          sc.strategy[h] = { raise: r.P[i], call: 0, fold: 1 - r.P[i] };
          sc.reach[h] = 1;
          sc.ev[h] = { raise: r.evS[i], fold: -0.5 };
        });
        sc.desc = `ヘッズアップ・有効スタック ${S}bb：SB(0.5bb) はオールインかフォールド`;
      } else if (sc.pushfold === 'bb') {
        sc.strategy = {}; sc.reach = {}; sc.ev = {};
        ALL_HANDS.forEach((h, j) => {
          sc.strategy[h] = { raise: 0, call: r.Q[j], fold: 1 - r.Q[j] };
          sc.reach[h] = 1; // BB はどのハンドでもこのスポットに到達する
          sc.ev[h] = { call: r.evB[j], fold: -1 };
        });
        sc.desc = `ヘッズアップ・有効スタック ${S}bb：SB が ${S}bb オールイン → BB(1bb) はコールかフォールド`;
      }
      if (sc.pushfold) { sc.stack = S; sc.exploitability = r.exploitability; }
    }
    return r;
  }

  const api = { solve, setStack };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PushFold = api;
})(typeof window !== 'undefined' ? window : globalThis);
