// 169x169 プリフロップ・オールインエクイティ表を生成（モンテカルロ, worker_threads 並列）
// 使い方: SAMPLES=40000 node tools/gen-equity.js js/equity-data.js
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const E = require('../js/evaluator.js');
const R = require('../js/ranges.js');
const H = R.ALL_HANDS, N = H.length;
const SAMPLES = +process.env.SAMPLES || 20000;
if (isMainThread) {
  const nW = require('os').cpus().length;
  const pairs = []; for (let i = 0; i < N; i++) for (let j = i; j < N; j++) pairs.push([i, j]);
  const eq = new Float64Array(N * N); let done = 0, t = Date.now();
  for (let w = 0; w < nW; w++) {
    const wk = new Worker(__filename, { workerData: { pairs: pairs.filter((_, k) => k % nW === w) } });
    wk.on('message', res => {
      for (const [i, j, e] of res) { eq[i * N + j] = e; eq[j * N + i] = 1 - e; }
      if (++done === nW) {
        const u16 = new Uint16Array(N * N);
        for (let k = 0; k < N * N; k++) u16[k] = Math.round(eq[k] * 65535);
        const b64 = Buffer.from(u16.buffer).toString('base64');
        require('fs').writeFileSync(process.argv[2],
`// 169x169 プリフロップ・オールインエクイティ表（行ハンドの列ハンドに対するエクイティ, Uint16/65535, base64）
// ハンドの並びは Ranges.ALL_HANDS と同じ。モンテカルロ ${SAMPLES} 回/組で生成。
(function (root) {
  const B64 = '${b64}';
  function decode() {
    const bin = typeof atob !== 'undefined' ? atob(B64) : Buffer.from(B64, 'base64').toString('binary');
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const u16 = new Uint16Array(u8.buffer), out = new Float64Array(u16.length);
    for (let i = 0; i < u16.length; i++) out[i] = u16[i] / 65535;
    return out;
  }
  const api = { decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PreflopEquity = api;
})(typeof window !== 'undefined' ? window : globalThis);
`);
        console.log('done', (Date.now() - t) / 1000 + 's');
      }
    });
  }
} else {
  const combos = H.map(h => R.handCombos(h).map(([a, b]) => [a > b ? a : b, a > b ? b : a]));
  // ランク→Evaluatorのカード表現は ranges.handCombos と同じ
  const out = [];
  const deck = new Int32Array(52);
  for (const [i, j] of workerData.pairs) {
    const valid = [];
    for (const a of combos[i]) for (const b of combos[j])
      if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) valid.push([a, b]);
    let score = 0;
    const per = Math.ceil(SAMPLES / valid.length);
    for (const [a, b] of valid) {
      let n = 0;
      for (let c = 0; c < 52; c++) if (c !== a[0] && c !== a[1] && c !== b[0] && c !== b[1]) deck[n++] = c;
      for (let s = 0; s < per; s++) {
        for (let k = 0; k < 5; k++) { const r = k + Math.floor(Math.random() * (n - k)); const t = deck[k]; deck[k] = deck[r]; deck[r] = t; }
        const bd = [deck[0], deck[1], deck[2], deck[3], deck[4]];
        const x = E.eval7([a[0], a[1], ...bd]), y = E.eval7([b[0], b[1], ...bd]);
        score += x > y ? 1 : x === y ? 0.5 : 0;
      }
    }
    out.push([i, j, score / (per * valid.length)]);
  }
  parentPort.postMessage(out);
}
