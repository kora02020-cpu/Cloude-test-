// ソルバー画面: 条件を入力して Web Worker で CFR を回し、結果をアクションツリーでたどって表示する
(function () {
  const { SCENARIOS, ALL_HANDS, handCombos, parseRange, gridHand, R: GR } = Ranges;
  const E = Evaluator;
  const $ = id => document.getElementById(id);
  const byId = id => SCENARIOS.find(s => s.id === id);
  const RK = '23456789TJQKA';
  const SUIT_SYM = ['♠', '♥', '♦', '♣'];
  const SUIT_CLASS = ['', 'red', 'blue', 'green'];

  // ---------- プリセット ----------
  function rangeText(sc, key) {
    return ALL_HANDS.filter(h => sc.strategy[h][key] > 0)
      .map(h => { const f = sc.strategy[h][key]; return f >= 0.999 ? h : `${h}:${+f.toFixed(2)}`; }).join(', ');
  }
  const PRESETS = [
    { name: 'BTN オープン vs BB コール（シングルレイズドポット）', oop: ['BB_vs_BTN', 'call'], ip: ['BTN_RFI', 'raise'], pos: ['BB', 'BTN'], pot: 5.5, stack: 97.5 },
    { name: 'CO オープン vs BTN コール（シングルレイズドポット）', oop: ['CO_RFI', 'raise'], ip: ['BTN_vs_CO', 'call'], pos: ['CO', 'BTN'], pot: 6.5, stack: 97.5 },
    { name: 'SB オープン vs BB コール（シングルレイズドポット）', oop: ['SB_RFI', 'raise'], ip: ['BB_vs_SB', 'call'], pos: ['SB', 'BB'], pot: 6, stack: 97 },
    { name: 'BB 3ベット vs BTN コール（3ベットポット）', oop: ['BB_vs_BTN', 'raise'], ip: ['BTN_vs_BB3b', 'call'], pos: ['BB', 'BTN'], pot: 22.5, stack: 89 },
  ];
  let pos = ['OOP', 'IP'];
  function applyPreset() {
    const p = PRESETS[+$('svPreset').value];
    $('svRangeOOP').value = rangeText(byId(p.oop[0]), p.oop[1]);
    $('svRangeIP').value = rangeText(byId(p.ip[0]), p.ip[1]);
    $('svPot').value = p.pot; $('svStack').value = p.stack;
    pos = p.pos;
  }
  PRESETS.forEach((p, i) => $('svPreset').append(new Option(p.name, i)));
  $('svPreset').addEventListener('change', applyPreset);
  applyPreset();
  $('svRangeOOP').addEventListener('input', () => { pos = ['OOP', 'IP']; });
  $('svRangeIP').addEventListener('input', () => { pos = ['OOP', 'IP']; });

  $('svRandBoard').addEventListener('click', () => {
    const n = $('svBoard').value.replace(/\s/g, '').length / 2 === 4 ? 4 : 5;
    const d = []; for (let c = 0; c < 52; c++) d.push(c);
    for (let i = 0; i < n; i++) { const j = i + Math.floor(Math.random() * (52 - i)); [d[i], d[j]] = [d[j], d[i]]; }
    $('svBoard').value = d.slice(0, n).map(E.cardToString).join('');
  });

  // ---------- Worker ----------
  const workerSrc = solverCoreFactory.toString() + `
    const core = solverCoreFactory();
    let solver = null, running = false, cfgMax = 0, target = 0, chunk = 10;
    function loop() {
      if (!running) return;
      solver.iterate(chunk);
      const ex = solver.exploitability();
      const done = ex.pctPot <= target || solver.iter >= cfgMax;
      self.postMessage({ type: 'progress', iter: solver.iter, expl: ex, done });
      if (done) { running = false; return; }
      setTimeout(loop, 0);
    }
    self.onmessage = e => {
      const m = e.data;
      if (m.type === 'solve') {
        try { solver = core.createSolver(m.cfg, m.data); }
        catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); return; }
        cfgMax = m.maxIter; target = m.target; chunk = m.chunk; running = true;
        self.postMessage({ type: 'started', nodes: solver.nodeCount });
        setTimeout(loop, 0);
      } else if (m.type === 'stop') { running = false; self.postMessage({ type: 'stopped', iter: solver ? solver.iter : 0 }); }
      else if (m.type === 'node') { self.postMessage({ type: 'node', id: m.id, info: solver.nodeInfo(m.path) }); }
    };`;
  let worker = null, reqId = 0;
  const pending = new Map();
  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'node') { const f = pending.get(m.id); pending.delete(m.id); if (f) f(m.info); }
      else if (m.type === 'progress') onProgress(m);
      else if (m.type === 'started') $('svProgress').innerHTML = `<p class="muted">ゲームツリー ${m.nodes.toLocaleString()} ノードで計算を開始…</p>`;
      else if (m.type === 'stopped') { solving = false; setSolveButtons(); showNode(); }
      else if (m.type === 'error') { solving = false; setSolveButtons(); $('svProgress').innerHTML = `<p class="error">${m.message}</p>`; }
    };
    return worker;
  }
  const query = path => new Promise(res => { const id = ++reqId; pending.set(id, res); worker.postMessage({ type: 'node', id, path }); });

  // ---------- 計算開始 ----------
  let game = null, solving = false, path = [], startTime = 0;
  function setSolveButtons() { $('svSolve').disabled = solving; $('svStop').disabled = !solving; }
  setSolveButtons();
  function sizes(str) {
    return str.split(/[,\s、]+/).filter(Boolean).map(x => {
      const v = parseFloat(x); if (!(v > 0)) throw new Error('サイズは「33, 75」のように % で入力してください'); return v / 100;
    });
  }
  function comboClass(c) {
    const a = c[0] >> 2, b = c[1] >> 2, hi = Math.max(a, b), lo = Math.min(a, b);
    if (a === b) return RK[a] + RK[a];
    return RK[hi] + RK[lo] + ((c[0] & 3) === (c[1] & 3) ? 's' : 'o');
  }

  $('svSolve').addEventListener('click', () => {
    try {
      const board = E.parseCards($('svBoard').value);
      if (board.length !== 4 && board.length !== 5) throw new Error('ボードはターン（4枚）かリバー（5枚）で入力してください');
      const pot = parseFloat($('svPot').value), stack = parseFloat($('svStack').value);
      if (!(pot > 0) || !(stack > 0)) throw new Error('ポットとスタックを正の数で入力してください');
      const street = board.length === 4 ? 'turn' : 'river';
      const runouts = []; if (street === 'turn') for (let c = 0; c < 52; c++) if (!board.includes(c)) runouts.push(c);
      const dead = new Set(board);
      const hands = [], weights = [], strengths = [], classes = [];
      [$('svRangeOOP').value, $('svRangeIP').value].forEach((txt, p) => {
        const rng = parseRange(txt);
        const hs = [], ws = [];
        for (const [h, w] of Object.entries(rng)) if (w > 0) for (const c of handCombos(h)) if (!dead.has(c[0]) && !dead.has(c[1])) { hs.push(c); ws.push(w); }
        if (!hs.length) throw new Error(`${p ? 'IP' : 'OOP'} のレンジが空です`);
        hands.push(hs); weights.push(ws); classes.push(hs.map(comboClass));
        strengths.push((street === 'turn' ? runouts : [null]).map(rc => Int32Array.from(hs.map(c =>
          rc !== null && (c[0] === rc || c[1] === rc) ? -1 : E.eval7([c[0], c[1], ...board, ...(rc === null ? [] : [rc])])))));
      });
      const bet = sizes($('svBets').value), raise = sizes($('svRaises').value || '');
      const cfg = { pot, stack, street, runouts, allin: $('svAllin').checked, maxRaises: +$('svMaxRaise').value,
        sizes: { oop: { bet, raise }, ip: { bet, raise } } };
      game = { cfg, board, hands, weights, classes, pos: pos.slice(), street };
      path = []; crumbs = [];
      $('svResult').hidden = true;
      $('svProgress').innerHTML = '<p class="muted">準備中…</p>';
      solving = true; setSolveButtons(); startTime = performance.now();
      ensureWorker().postMessage({ type: 'solve', cfg, data: { hands, weights, strengths },
        maxIter: street === 'turn' ? 600 : 2000, target: +$('svTarget').value, chunk: street === 'turn' ? 20 : 25 });
    } catch (e) {
      $('svProgress').innerHTML = `<p class="error">${e.message}</p>`;
    }
  });
  $('svStop').addEventListener('click', () => worker && worker.postMessage({ type: 'stop' }));

  function onProgress(m) {
    const sec = ((performance.now() - startTime) / 1000).toFixed(1);
    const target = +$('svTarget').value;
    const prog = Math.min(1, Math.log(Math.max(m.expl.pctPot, 1e-6) / 50) / Math.log(target / 50));
    $('svProgress').innerHTML = `<div class="sv-bar"><div style="width:${Math.max(2, prog * 100).toFixed(0)}%"></div></div>
      <p class="muted small">反復 ${m.iter} 回・${sec} 秒・可搾取度 <b>${m.expl.pctPot.toFixed(2)}% ポット</b>（${m.expl.chips.toFixed(3)}bb）
      ${m.done ? '— 計算完了' : '— 計算中…'}</p>
      ${m.done ? '' : '<button id="svPeek" type="button">途中の結果を表示</button>'}`;
    if (!m.done) $('svPeek').addEventListener('click', showNode);
    if (m.done) { solving = false; setSolveButtons(); }
    if (m.done) showNode();
  }

  // ---------- 結果表示 ----------
  function actionLabel(a, pot) {
    const pc = a.amount !== undefined && pot ? `（${Math.round(a.amount / pot * 100)}%）` : '';
    switch (a.type) {
      case 'check': return 'チェック';
      case 'call': return `コール`;
      case 'fold': return 'フォールド';
      case 'bet': return `ベット ${a.amount}bb${pc}`;
      case 'raise': return `レイズ ${a.amount}bb`;
      case 'allin': return `オールイン ${a.amount}bb`;
    }
  }
  function actionColors(actions) {
    const reds = ['#f0a35e', '#e5484d', '#b8282e', '#86171c'];
    let k = 0;
    return actions.map(a => a.type === 'fold' ? '#3e63dd' : a.type === 'check' || a.type === 'call' ? '#30a46c'
      : a.type === 'allin' ? '#5c0c12' : reds[Math.min(k++, reds.length - 1)]);
  }
  function cardHTML(c) { return `<span class="mini-card ${SUIT_CLASS[c & 3]}">${RK[c >> 2]}${SUIT_SYM[c & 3]}</span>`; }

  let crumbs = []; // 表示用のパスのラベル
  async function showNode() {
    if (!game || !worker) return;
    const info = await query(path);
    $('svResult').hidden = false;
    const board = game.board.slice();
    // パスの説明
    $('svPath').innerHTML = `<button class="crumb" data-depth="0">${game.street === 'turn' ? 'ターン' : 'リバー'}開始</button>` +
      crumbs.map((c, i) => `<span>›</span><button class="crumb" data-depth="${i + 1}">${c}</button>`).join('');
    $('svPath').querySelectorAll('.crumb').forEach(b => b.addEventListener('click', () => {
      const d = +b.dataset.depth; path = path.slice(0, d); crumbs = crumbs.slice(0, d); showNode();
    }));
    let riverCard = null;
    { // パス中のリバーカード
      let pi = 0;
      for (const c of crumbs) { if (c.startsWith('リバー ')) riverCard = game.cfg.runouts[path[pi]]; pi++; }
    }
    if (riverCard !== null) board.push(riverCard);
    const boardHTML = `<div class="sv-board">${board.map(cardHTML).join('')}</div>`;

    if (info.type === 'fold' || info.type === 'showdown') {
      $('svNodeHead').innerHTML = `${boardHTML}<p>${info.type === 'fold' ? 'フォールドでハンド終了' : 'ショーダウン'}。パンくずリストから前のノードに戻れます。</p>`;
      $('svGrid').innerHTML = ''; $('svHand').innerHTML = ''; $('svLegend').innerHTML = ''; $('svSummary').innerHTML = '';
      return;
    }
    if (info.type === 'chance') {
      const opts = info.runouts.map((c, i) => `<option value="${i}">${E.cardToString(c)}</option>`).join('');
      $('svNodeHead').innerHTML = `${boardHTML}<p>リバーのカードを選んでください</p>
        <label>リバー <select id="svRiver">${opts}</select></label> <button id="svRiverGo" class="primary">表示</button>`;
      $('svRiverGo').addEventListener('click', () => {
        const i = +$('svRiver').value; path.push(i); crumbs.push('リバー ' + E.cardToString(info.runouts[i])); showNode();
      });
      $('svGrid').innerHTML = ''; $('svHand').innerHTML = ''; $('svLegend').innerHTML = ''; $('svSummary').innerHTML = '';
      return;
    }
    const p = info.player, n = game.hands[p].length, A = info.actions.length;
    const reach = info.reach[p], colors = actionColors(info.actions);
    // 全体の頻度
    let tot = 0; const freq = new Array(A).fill(0); let evSum = 0, evW = 0, eqSum = 0, eqW = 0;
    for (let i = 0; i < n; i++) {
      const r = reach[i]; if (!r) continue; tot += r;
      for (let a = 0; a < A; a++) freq[a] += r * info.strategy[a * n + i];
      if (info.ev[i] !== null) { evSum += r * info.ev[i]; evW += r; }
      if (info.equity && info.equity[i] !== null) { eqSum += r * info.equity[i]; eqW += r; }
    }
    $('svNodeHead').innerHTML = `${boardHTML}
      <p><b>${pos[p]}</b>（${p ? 'IP' : 'OOP'}）のアクション・ポット ${+info.pot.toFixed(2)}bb</p>
      <div class="sv-actions">${info.actions.map((a, k) => `<button class="sv-act" data-k="${k}" style="--c:${colors[k]}">
        <span>${actionLabel(a, info.pot)}</span><b>${tot ? (freq[k] / tot * 100).toFixed(1) : 0}%</b></button>`).join('')}</div>`;
    $('svNodeHead').querySelectorAll('.sv-act').forEach(b => b.addEventListener('click', () => {
      const k = +b.dataset.k; path.push(k); crumbs.push(`${pos[p]} ${actionLabel(info.actions[k], info.pot)}`); showNode();
    }));
    $('svSummary').innerHTML = `<span>レンジのEV <b>${evW ? (evSum / evW).toFixed(2) : '–'}bb</b></span>`
      + (eqW ? `<span>レンジのエクイティ <b>${(eqSum / eqW * 100).toFixed(1)}%</b></span>` : '')
      + `<span>このノードに来るコンボ <b>${tot.toFixed(1)}</b></span>`;
    // クラス別に集計
    const byClass = new Map();
    for (let i = 0; i < n; i++) {
      const k = game.classes[p][i]; if (!byClass.has(k)) byClass.set(k, []); byClass.get(k).push(i);
    }
    const grid = $('svGrid'); grid.innerHTML = '';
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
      const h = gridHand(i, j), idx = byClass.get(h) || [];
      let w = 0; const f = new Array(A).fill(0);
      for (const x of idx) { const r = reach[x]; if (!r) continue; w += r; for (let a = 0; a < A; a++) f[a] += r * info.strategy[a * n + x]; }
      const cell = document.createElement('div');
      cell.className = 'cell' + (w ? '' : ' out');
      cell.innerHTML = (w ? f.map((x, a) => `<div class="bar" style="width:${x / w * 100}%;background:${colors[a]}"></div>`).join('') : '') + `<span>${h}</span>`;
      const show = () => {
        grid.querySelectorAll('.sel').forEach(c => c.classList.remove('sel')); cell.classList.add('sel');
        const rows = idx.filter(x => reach[x] > 1e-9).map(x => `<tr><td>${cardHTML(game.hands[p][x][0])}${cardHTML(game.hands[p][x][1])}</td>
          <td><div class="freq-bar">${info.actions.map((_, a) => `<div style="width:${info.strategy[a * n + x] * 100}%;background:${colors[a]}"></div>`).join('')}</div>
          <div class="muted small">${info.actions.map((a, k) => info.strategy[k * n + x] >= 0.005 ? `${actionLabel(a)} ${(info.strategy[k * n + x] * 100).toFixed(0)}%` : '').filter(Boolean).join(' / ')}</div></td>
          <td class="num">${info.ev[x] === null ? '–' : info.ev[x].toFixed(2)}</td>
          <td class="num">${info.equity && info.equity[x] !== null ? (info.equity[x] * 100).toFixed(0) + '%' : '–'}</td></tr>`).join('');
        $('svHand').innerHTML = `<h2>${h}</h2>${w ? `<div class="sv-combos"><table><thead><tr><th>コンボ</th><th>戦略</th><th>EV</th><th>Eq</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : '<p class="muted small">このノードに到達するコンボはありません。</p>'}`;
      };
      cell.addEventListener('mouseenter', show); cell.addEventListener('click', show);
      grid.append(cell);
    }
    $('svLegend').innerHTML = info.actions.map((a, k) => `<span><i class="sw" style="background:${colors[k]}"></i>${actionLabel(a, info.pot)}</span>`).join('');
    $('svHand').innerHTML = '<p class="muted">ハンドにカーソルを合わせると、コンボごとの戦略・EV・エクイティが表示されます</p>';
  }
})();
