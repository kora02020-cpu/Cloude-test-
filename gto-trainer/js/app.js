(function () {
  const { SCENARIOS, ALL_HANDS, gridHand, combosOf, rangeStats, parseRange, handCombos } = Ranges;
  const $ = id => document.getElementById(id);
  const pct = x => (x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0) + '%';
  const ACTION_LABEL = { raise: 'レイズ', call: 'コール', fold: 'フォールド' };
  const byId = id => SCENARIOS.find(s => s.id === id);
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ---------- タブ ----------
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === btn.dataset.tab));
  }));

  // シナリオ選択肢
  function fillSelect(sel) {
    const groups = {};
    for (const sc of SCENARIOS) (groups[sc.group] ||= []).push(sc);
    for (const [g, list] of Object.entries(groups)) {
      const og = document.createElement('optgroup'); og.label = g;
      for (const sc of list) og.append(new Option(sc.name, sc.id));
      sel.append(og);
    }
  }
  [$('viewerScenario'), $('trainerScenario'), $('eqScenario')].forEach(fillSelect);

  // ---------- レンジ表 ----------
  function freqBar(s) {
    return `<div class="freq-bar">
      <div style="width:${s.raise * 100}%;background:var(--raise)"></div>
      <div style="width:${s.call * 100}%;background:var(--call)"></div></div>`;
  }
  function renderGrid() {
    const sc = byId($('viewerScenario').value);
    const grid = $('grid'); grid.innerHTML = '';
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
      const h = gridHand(i, j), s = sc.strategy[h];
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.innerHTML = `<div class="bar raise" style="width:${s.raise * 100}%"></div>
        <div class="bar call" style="width:${s.call * 100}%"></div><span>${h}</span>`;
      const show = () => {
        grid.querySelectorAll('.sel').forEach(c => c.classList.remove('sel'));
        cell.classList.add('sel');
        $('handInfo').innerHTML = `<h2>${h}</h2><div class="muted small">${combosOf(h)} コンボ</div>
          ${freqBar(s)}
          ${sc.actions.map(a => `<div class="freq-row"><span><i class="sw ${a}"></i>${ACTION_LABEL[a]}</span><b>${pct(s[a])}</b></div>`).join('')}`;
      };
      cell.addEventListener('mouseenter', show);
      cell.addEventListener('click', show);
      grid.append(cell);
    }
    const st = rangeStats(sc);
    $('viewerStats').innerHTML = sc.actions.map(a => `<span><i class="sw ${a}"></i>${ACTION_LABEL[a]} ${pct(st[a])}</span>`).join('');
    store.set('viewerScenario', sc.id);
  }
  $('viewerScenario').value = store.get('viewerScenario', 'BTN_RFI');
  if (!byId($('viewerScenario').value)) $('viewerScenario').value = 'BTN_RFI';
  $('viewerScenario').addEventListener('change', renderGrid);
  renderGrid();

  // ---------- トレーナー ----------
  const SUIT_SYM = ['♠', '♥', '♦', '♣'];
  const SUIT_CLASS = ['', 'red', 'blue', 'green']; // 4色デッキ
  let current = null;
  let stats = store.get('trainerStats', { hands: 0, score: 0, blunders: 0, streak: 0, history: [] });

  function pickHand(sc) {
    const focus = $('focusMode').checked;
    const items = ALL_HANDS.map(h => {
      const s = sc.strategy[h];
      let w = combosOf(h);
      if (focus) {
        const maxF = Math.max(s.raise, s.call, s.fold);
        if (maxF === 1 && s.fold === 1) w *= isNearBoundary(sc, h) ? 0.6 : 0.05; // 明らかなフォールド
        else if (maxF === 1) w *= 0.35;                                         // 明らかなプレイ
      }
      return [h, w];
    });
    let total = items.reduce((a, b) => a + b[1], 0), x = Math.random() * total;
    for (const [h, w] of items) { if ((x -= w) <= 0) return h; }
    return items[items.length - 1][0];
  }
  function isNearBoundary(sc, h) {
    const idx = ALL_HANDS.indexOf(h), i = Math.floor(idx / 13), j = idx % 13;
    for (const [di, dj] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a > 12 || b > 12) continue;
      if (sc.strategy[gridHand(a, b)].fold < 1) return true;
    }
    return false;
  }
  function suitsFor(h) {
    const s1 = Math.floor(Math.random() * 4);
    if (h.length === 3 && h[2] === 's') return [s1, s1];
    let s2; do { s2 = Math.floor(Math.random() * 4); } while (s2 === s1);
    return [s1, s2];
  }
  function cardHTML(rank, suit) {
    return `<div class="card ${SUIT_CLASS[suit]}">${rank === 'T' ? '10' : rank}<small>${SUIT_SYM[suit]}</small></div>`;
  }

  function newHand() {
    const sel = $('trainerScenario').value;
    const sc = sel === 'random' ? SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)] : byId(sel);
    const hand = pickHand(sc);
    const suits = suitsFor(hand);
    current = { sc, hand, answered: false };
    $('spotName').textContent = sc.name;
    $('heroCards').innerHTML = cardHTML(hand[0], suits[0]) + cardHTML(hand[1], suits[1]);
    $('actionButtons').innerHTML = '';
    sc.actions.forEach((a, k) => {
      const b = document.createElement('button');
      b.className = a; b.dataset.action = a;
      b.textContent = `${ACTION_LABEL[a]} (${k + 1})`;
      b.addEventListener('click', () => answer(a));
      $('actionButtons').append(b);
    });
    $('feedback').innerHTML = '';
    $('nextHand').classList.add('hidden');
  }

  function answer(action) {
    if (!current || current.answered) return;
    current.answered = true;
    const s = current.sc.strategy[current.hand];
    const best = Math.max(...current.sc.actions.map(a => s[a]));
    const f = s[action];
    const score = best > 0 ? f / best : 0;
    let verdict, cls;
    if (f === 0) { verdict = 'ミス ✗'; cls = 'bad'; }
    else if (f === best) { verdict = '正解 ✓'; cls = 'good'; }
    else { verdict = '許容範囲（混合戦略）'; cls = 'ok'; }

    stats.hands++; stats.score += score;
    if (cls === 'bad') { stats.blunders++; stats.streak = 0; } else stats.streak++;
    stats.history.unshift({ spot: current.sc.name, hand: current.hand, action, cls,
      gto: current.sc.actions.filter(a => s[a] > 0).map(a => `${ACTION_LABEL[a]} ${pct(s[a])}`).join(' / ') });
    stats.history = stats.history.slice(0, 50);
    store.set('trainerStats', stats);

    document.querySelectorAll('#actionButtons button').forEach(b => {
      b.disabled = true; if (b.dataset.action === action) b.classList.add('chosen');
    });
    $('feedback').innerHTML = `<div class="verdict ${cls}">${verdict}</div>
      ${freqBar(s)}
      ${current.sc.actions.map(a => `<div class="freq-row"><span>${ACTION_LABEL[a]}</span><b>${pct(s[a])}</b></div>`).join('')}`;
    $('nextHand').classList.remove('hidden');
    renderStats();
  }

  function renderStats() {
    $('sHands').textContent = stats.hands;
    $('sAcc').textContent = stats.hands ? (stats.score / stats.hands * 100).toFixed(1) + '%' : '–';
    $('sBlunder').textContent = stats.blunders;
    $('sStreak').textContent = stats.streak;
    $('history').innerHTML = stats.history.map(h =>
      `<li><span>${h.spot} — <b>${h.hand}</b> → <span class="${h.cls}">${ACTION_LABEL[h.action]}</span></span>
       <span class="muted">${h.gto}</span></li>`).join('');
  }

  $('nextHand').addEventListener('click', newHand);
  $('trainerScenario').addEventListener('change', newHand);
  $('resetStats').addEventListener('click', () => {
    stats = { hands: 0, score: 0, blunders: 0, streak: 0, history: [] };
    store.set('trainerStats', stats); renderStats();
  });
  document.addEventListener('keydown', e => {
    if (!$('trainer').classList.contains('active') || e.target.matches('input, select')) return;
    if (e.code === 'Space' && current?.answered) { e.preventDefault(); newHand(); }
    const n = parseInt(e.key, 10);
    if (n >= 1 && current && !current.answered && current.sc.actions[n - 1]) answer(current.sc.actions[n - 1]);
  });
  renderStats();
  newHand();

  // ---------- エクイティ計算 ----------
  function villainCombos() {
    const scId = $('eqScenario').value;
    if (scId) {
      const sc = byId(scId), out = [];
      for (const h of ALL_HANDS) {
        const s = sc.strategy[h], w = s.raise + s.call;
        if (w > 0) for (const c of handCombos(h)) out.push([c[0], c[1], w]);
      }
      return out;
    }
    const txt = $('eqVillain').value.trim();
    if (/^([2-9TJQKA][shdc]){2}$/i.test(txt.replace(/\s/g, ''))) {
      const c = Evaluator.parseCards(txt); return [[c[0], c[1], 1]];
    }
    const range = parseRange(txt), out = [];
    for (const [h, w] of Object.entries(range)) for (const c of handCombos(h)) out.push([c[0], c[1], w]);
    if (!out.length) throw new Error('相手のハンド/レンジを入力してください');
    return out;
  }

  $('eqRun').addEventListener('click', () => {
    const res = $('eqResult');
    try {
      const hero = Evaluator.parseCards($('eqHero').value);
      if (hero.length !== 2) throw new Error('あなたのハンドは2枚で入力してください');
      const board = Evaluator.parseCards($('eqBoard').value);
      if (board.length > 5 || [3, 4, 5, 0].indexOf(board.length) < 0) throw new Error('ボードは0・3・4・5枚で入力してください');
      if (board.some(c => hero.includes(c))) throw new Error('ハンドとボードでカードが重複しています');
      const vc = villainCombos();
      const iters = parseInt($('eqIter').value, 10);
      res.innerHTML = '<p class="muted">計算中…</p>';
      setTimeout(() => {
        try {
          const t = performance.now();
          const r = Evaluator.equity(hero, vc, board, iters);
          const ms = Math.round(performance.now() - t);
          let made = '';
          if (board.length >= 3) made = `<p>現在の役: <b>${Evaluator.category(Evaluator.eval7([...hero, ...board]))}</b></p>`;
          res.innerHTML = `<div class="eq-big">${(r.equity * 100).toFixed(2)}%</div>
            <div class="eq-bar"><div style="width:${r.win * 100}%;background:var(--call)"></div>
              <div style="width:${r.tie * 100}%;background:var(--accent)"></div>
              <div style="width:${r.lose * 100}%;background:var(--raise)"></div></div>
            <p>勝ち ${(r.win * 100).toFixed(2)}% ・ 引き分け ${(r.tie * 100).toFixed(2)}% ・ 負け ${(r.lose * 100).toFixed(2)}%</p>
            ${made}<p class="muted small">${r.n.toLocaleString()} 回試行 / ${ms}ms</p>`;
        } catch (e) { res.innerHTML = `<p class="error">${e.message}</p>`; }
      }, 20);
    } catch (e) { res.innerHTML = `<p class="error">${e.message}</p>`; }
  });
})();
