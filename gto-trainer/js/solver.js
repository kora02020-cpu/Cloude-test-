// ポストフロップ CFR ソルバー（ヘッズアップ・ターン／リバー）
// CFR+（後悔値マッチング+、線形平均）をコンボ単位でベクトル化して解く。
// ショーダウンとフォールドの計算は、カードの重なり（ブロッカー）を考慮した O(n) の掃き出しで行う。
// このファイルの solverCoreFactory は Web Worker 内でも動くよう、外部に依存しない純粋な関数として書いている。
function solverCoreFactory() {
  // ---------- ゲームツリー ----------
  // input: { pot, stack, street: 'turn'|'river', runouts: [card...] (ターンのみ),
  //          sizes: { oop: {bet:[], raise:[]}, ip: {bet:[], raise:[]} }, allin: bool, maxRaises }
  function buildTree(cfg) {
    const round = x => Math.round(x * 100) / 100;
    let nodeCount = 0;
    function street(st) { return action({ ...st, b: [0, 0], toAct: 0, raises: 0, checked: false }); }
    function endStreet(st) {
      const pot = st.pot0 + st.b[0] + st.b[1];
      const stack = st.stack - st.b[0];
      if (st.street === 'turn') {
        nodeCount++;
        return { type: 'chance', pot, stack, contrib: pot / 2,
          children: cfg.runouts.map(() => stack <= 1e-9
            ? { type: 'showdown', contrib: pot / 2, pot }
            : street({ pot0: pot, stack, street: 'river' })) };
      }
      return { type: 'showdown', contrib: pot / 2, pot };
    }
    function action(st) {
      nodeCount++;
      const p = st.toAct, o = 1 - p, sz = p === 0 ? cfg.sizes.oop : cfg.sizes.ip;
      const facing = st.b[o] - st.b[p];
      const potNow = st.pot0 + st.b[0] + st.b[1];
      const node = { type: 'action', player: p, pot: potNow, contrib: [st.pot0 / 2 + st.b[0], st.pot0 / 2 + st.b[1]],
        actions: [], children: [] };
      const add = (a, child) => { node.actions.push(a); node.children.push(child); };
      const amounts = (list, base, extra) => {
        const out = [];
        for (const f of list) {
          const to = round(base + f * extra);
          if (to < st.stack - 1e-9 && to > base + 1e-9 && !out.includes(to)) out.push(to);
        }
        if ((cfg.allin || !out.length) && st.stack > base + 1e-9) out.push(round(st.stack));
        return [...new Set(out)];
      };
      if (facing <= 1e-9) {
        if (p === 0) add({ type: 'check' }, action({ ...st, toAct: 1, checked: true }));
        else add({ type: 'check' }, endStreet(st));
        for (const to of amounts(sz.bet, 0, potNow)) {
          const b = st.b.slice(); b[p] = to;
          add({ type: to >= st.stack - 1e-9 ? 'allin' : 'bet', amount: to }, action({ ...st, b, toAct: o }));
        }
      } else {
        add({ type: 'fold' }, { type: 'fold', folder: p, contrib: [st.pot0 / 2 + st.b[0], st.pot0 / 2 + st.b[1]] });
        const bc = st.b.slice(); bc[p] = st.b[o];
        add({ type: 'call', amount: st.b[o] }, endStreet({ ...st, b: bc }));
        if (st.raises < cfg.maxRaises && st.b[o] < st.stack - 1e-9) {
          for (const to of amounts(sz.raise, st.b[o], potNow + facing)) {
            const b = st.b.slice(); b[p] = to;
            add({ type: to >= st.stack - 1e-9 ? 'allin' : 'raise', amount: to }, action({ ...st, b, toAct: o, raises: st.raises + 1 }));
          }
        }
      }
      return node;
    }
    const root = street({ pot0: cfg.pot, stack: cfg.stack, street: cfg.street });
    return { root, nodeCount };
  }

  // ---------- ソルバー ----------
  // data: { hands: [[c1,c2]...] x2, weights: [w...] x2, strengths: [[Int32Array per runout]] x2 (ブロックは -1) }
  function createSolver(cfg, data) {
    const { root, nodeCount } = buildTree(cfg);
    const N = [data.hands[0].length, data.hands[1].length];
    const c1 = [0, 1].map(p => Int32Array.from(data.hands[p].map(h => h[0])));
    const c2 = [0, 1].map(p => Int32Array.from(data.hands[p].map(h => h[1])));
    const W = [0, 1].map(p => Float64Array.from(data.weights[p]));
    const nRun = cfg.street === 'turn' ? cfg.runouts.length : 1;
    const divisor = cfg.street === 'turn' ? cfg.runouts.length - 4 : 1;
    // 同じコンボの相手側インデックス
    const same = [0, 1].map(p => {
      const o = 1 - p, idx = new Map();
      data.hands[o].forEach((h, i) => idx.set(Math.min(h[0], h[1]) * 64 + Math.max(h[0], h[1]), i));
      return Int32Array.from(data.hands[p].map(h => idx.get(Math.min(h[0], h[1]) * 64 + Math.max(h[0], h[1])) ?? -1));
    });
    // 強さ順の並び（ランアウトごと）
    const STR = data.strengths;
    const order = [0, 1].map(p => Array.from({ length: nRun }, (_, r) => {
      const s = STR[p][r]; const idx = [];
      for (let i = 0; i < N[p]; i++) if (s[i] >= 0) idx.push(i);
      idx.sort((a, b) => s[a] - s[b]);
      return Int32Array.from(idx);
    }));
    // カードを含むハンド
    const withCard = [0, 1].map(p => {
      const out = Array.from({ length: 52 }, () => []);
      for (let i = 0; i < N[p]; i++) { out[c1[p][i]].push(i); out[c2[p][i]].push(i); }
      return out.map(a => Int32Array.from(a));
    });
    // ノードのストレージ
    (function alloc(n) {
      if (n.type === 'action') {
        const sz = n.actions.length * N[n.player];
        n.regret = new Float32Array(sz); n.avg = new Float32Array(sz);
      }
      if (n.children) n.children.forEach(alloc);
    })(root);

    const cs = new Float64Array(52);
    const disc = { pos: 0, neg: 0.5, avg: 0 };
    // ノードごとに作業用バッファを持たせる（各ノードは1回の走査で1度しか訪れないので再利用できる）
    function buf(node, key, size) {
      let b = node[key];
      if (!b || b.length !== size) b = node[key] = new Float64Array(size);
      return b;
    }
    function foldValue(p, oppReach, node, out) {
      const o = 1 - p, val = out || buf(node, 'v' + p, N[p]);
      const gain = node.folder === p ? -node.contrib[p] : node.contrib[o];
      let tot = 0; cs.fill(0);
      const b1 = c1[o], b2 = c2[o];
      for (let j = 0; j < N[o]; j++) { const w = oppReach[j]; if (w) { tot += w; cs[b1[j]] += w; cs[b2[j]] += w; } }
      const sm = same[p], a1 = c1[p], a2 = c2[p];
      for (let i = 0; i < N[p]; i++) {
        val[i] = gain * (tot - cs[a1[i]] - cs[a2[i]] + (sm[i] >= 0 ? oppReach[sm[i]] : 0));
      }
      return val;
    }
    function showdownValue(p, oppReach, r, c, out) {
      const o = 1 - p, val = out; val.fill(0);
      const tr = order[p][r], op = order[o][r], sp = STR[p][r], so = STR[o][r];
      const a1 = c1[p], a2 = c2[p], b1 = c1[o], b2 = c2[o];
      let tot = 0; cs.fill(0); let j = 0;
      for (let i = 0; i < tr.length;) {
        const s = sp[tr[i]];
        while (j < op.length && so[op[j]] < s) { const h = op[j++]; const w = oppReach[h]; if (w) { tot += w; cs[b1[h]] += w; cs[b2[h]] += w; } }
        while (i < tr.length && sp[tr[i]] === s) { const h = tr[i++]; val[h] = tot - cs[a1[h]] - cs[a2[h]]; }
      }
      tot = 0; cs.fill(0); j = op.length - 1;
      for (let i = tr.length - 1; i >= 0;) {
        const s = sp[tr[i]];
        while (j >= 0 && so[op[j]] > s) { const h = op[j--]; const w = oppReach[h]; if (w) { tot += w; cs[b1[h]] += w; cs[b2[h]] += w; } }
        while (i >= 0 && sp[tr[i]] === s) { const h = tr[i--]; val[h] -= tot - cs[a1[h]] - cs[a2[h]]; }
      }
      for (let i = 0; i < N[p]; i++) val[i] *= c;
      return val;
    }
    function strategy(node, useAvg, out) {
      const n = N[node.player], A = node.actions.length, src = useAvg ? node.avg : node.regret;
      const s = out || buf(node, 'sb', A * n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let a = 0; a < A; a++) { const v = src[a * n + i]; if (v > 0) sum += v; }
        if (sum > 0) for (let a = 0; a < A; a++) { const v = src[a * n + i]; s[a * n + i] = v > 0 ? v / sum : 0; }
        else for (let a = 0; a < A; a++) s[a * n + i] = 1 / A;
      }
      return s;
    }
    // mode: 'cfr' | 'br' | 'eval'
    function walk(node, p, oppReach, ownReach, mode, t, r) {
      if (node.type === 'fold') return foldValue(p, oppReach, node);
      if (node.type === 'showdown') return showdownValue(p, oppReach, r, node.contrib, buf(node, 'v' + p, N[p]));
      const np = N[p];
      if (node.type === 'chance') {
        const o = 1 - p, val = buf(node, 'v' + p, np); val.fill(0);
        const oR = buf(node, 'or' + p, N[o]), sR = buf(node, 'sr' + p, np);
        for (let k = 0; k < node.children.length; k++) {
          const card = cfg.runouts[k];
          oR.set(oppReach); for (const h of withCard[o][card]) oR[h] = 0;
          sR.set(ownReach); for (const h of withCard[p][card]) sR[h] = 0;
          const v = walk(node.children[k], p, oR, sR, mode, t, k);
          for (const h of withCard[p][card]) v[h] = 0;
          for (let i = 0; i < np; i++) val[i] += v[i];
        }
        for (let i = 0; i < np; i++) val[i] /= divisor;
        return val;
      }
      const A = node.actions.length, n = N[node.player];
      if (!node.rb) node.rb = Array.from({ length: A }, () => new Float64Array(n));
      if (node.player !== p) {
        const s = strategy(node, mode !== 'cfr');
        const val = buf(node, 'v' + p, np); val.fill(0);
        for (let a = 0; a < A; a++) {
          const nr = node.rb[a];
          let any = false;
          for (let i = 0; i < n; i++) { const x = oppReach[i] * s[a * n + i]; nr[i] = x; if (x) any = true; }
          if (!any) continue;
          const v = walk(node.children[a], p, nr, ownReach, mode, t, r);
          for (let i = 0; i < np; i++) val[i] += v[i];
        }
        return val;
      }
      const s = mode === 'br' ? null : strategy(node, mode === 'eval');
      const vals = node.vals || (node.vals = new Array(A));
      for (let a = 0; a < A; a++) {
        let nr = ownReach;
        if (s) { nr = node.rb[a]; for (let i = 0; i < n; i++) nr[i] = ownReach[i] * s[a * n + i]; }
        vals[a] = walk(node.children[a], p, oppReach, nr, mode, t, r);
      }
      const val = buf(node, 'v' + p, n);
      if (mode === 'br') {
        for (let i = 0; i < n; i++) { let m = -Infinity; for (let a = 0; a < A; a++) if (vals[a][i] > m) m = vals[a][i]; val[i] = m; }
        return val;
      }
      val.fill(0);
      for (let a = 0; a < A; a++) { const va = vals[a]; for (let i = 0; i < n; i++) val[i] += s[a * n + i] * va[i]; }
      if (mode === 'cfr') {
        const reg = node.regret, avg = node.avg;
        if (cfg.algo === 'cfr+') {
          for (let a = 0; a < A; a++) for (let i = 0; i < n; i++) {
            const k = a * n + i, R = reg[k] + vals[a][i] - val[i];
            reg[k] = R > 0 ? R : 0; avg[k] += t * ownReach[i] * s[k];
          }
        } else { // Discounted CFR (α=1.5, β=0, γ=2)
          const dp = disc.pos, dn = disc.neg, da = disc.avg;
          for (let a = 0; a < A; a++) { const va = vals[a]; for (let i = 0; i < n; i++) {
            const k = a * n + i, old = reg[k];
            reg[k] = old * (old > 0 ? dp : dn) + va[i] - val[i];
            avg[k] = avg[k] * da + ownReach[i] * s[k];
          } }
        }
      }
      return val;
    }

    let iter = 0;
    // 両者の重みの、カードが重ならない組の総量（正規化用）
    let mass = 0;
    { const v = foldValue(0, W[1], { folder: 1, contrib: [0, 1] }, new Float64Array(N[0])); for (let i = 0; i < N[0]; i++) mass += W[0][i] * v[i]; }
    function iterate(k) {
      for (let x = 0; x < k; x++) {
        iter++;
        const ta = Math.pow(iter, 1.5);
        disc.pos = ta / (ta + 1); disc.neg = 0.5; disc.avg = Math.pow(iter / (iter + 1), 2);
        for (let p = 0; p < 2; p++) walk(root, p, W[1 - p], W[p], 'cfr', iter, 0);
      }
      return iter;
    }
    function exploitability() {
      let tot = 0;
      for (let p = 0; p < 2; p++) {
        const v = walk(root, p, W[1 - p], W[p], 'br', 0, 0);
        for (let i = 0; i < N[p]; i++) tot += W[p][i] * v[i];
      }
      return { chips: tot / 2 / mass, pctPot: tot / 2 / mass / cfg.pot * 100 };
    }
    // パスで指定したノードの情報（行動側の戦略・到達率・EV）
    function nodeInfo(path) {
      let node = root, reach = [Float64Array.from(W[0]), Float64Array.from(W[1])], r = 0;
      for (const step of path) {
        if (node.type === 'chance') {
          const card = cfg.runouts[step];
          for (let p = 0; p < 2; p++) for (const h of withCard[p][card]) reach[p][h] = 0;
          r = step; node = node.children[step]; continue;
        }
        const p = node.player, n = N[p], s = strategy(node, true);
        const nr = new Float64Array(n);
        for (let i = 0; i < n; i++) nr[i] = reach[p][i] * s[step * n + i];
        reach[p] = nr; node = node.children[step];
      }
      const info = { type: node.type, pot: node.pot, contrib: node.contrib, folder: node.folder, reach: reach.map(x => Array.from(x)) };
      if (node.type === 'chance') { info.runouts = cfg.runouts; return info; }
      if (node.type !== 'action') return info;
      const p = node.player, n = N[p], o = 1 - p;
      info.player = p;
      info.actions = node.actions;
      info.strategy = Array.from(strategy(node, true, new Float64Array(node.actions.length * n)));
      // EV: 行動側の各コンボについて、ノード以降の損益 + すでに投入した額（フォールド = 0 の基準）
      const v = walk(node, p, reach[o], reach[p], 'eval', 0, r);
      const v2 = Float64Array.from(v);
      const childVals = node.vals.map(x => Float64Array.from(x)); // アクションごとの値（子ノードの値）
      const m = foldValue(p, reach[o], { folder: o, contrib: [1, 1] }, new Float64Array(n));
      const toEV = (x, i) => (m[i] > 1e-12 ? x / m[i] + node.contrib[p] : null);
      info.ev = Array.from(v2, toEV);
      info.actionEV = childVals.map(cv => Array.from(cv, toEV));
      // エクイティ（ランアウト未確定のターンでは省略）
      if (cfg.street === 'river' || path.length && pathHasChance(path)) {
        const sd = showdownValue(p, reach[o], r, 1, new Float64Array(n));
        info.equity = Array.from(sd, (x, i) => (m[i] > 1e-12 ? (x / m[i] + 1) / 2 : null));
      }
      return info;
    }
    function pathHasChance(path) {
      let node = root;
      for (const step of path) { if (node.type === 'chance') return true; node = node.children[step]; }
      return false;
    }
    return { iterate, exploitability, nodeInfo, nodeCount, get iter() { return iter; } };
  }
  return { buildTree, createSolver };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { solverCoreFactory };
