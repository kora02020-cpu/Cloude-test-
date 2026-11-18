(function () {
  const { SCENARIOS, ALL_HANDS, gridHand, combosOf, rangeStats, parseRange, handCombos } = Ranges;
  const $ = id => document.getElementById(id);
  const pct = x => (x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0) + '%';
  const ACTION_LABEL = { raise: 'レイズ', call: 'コール', fold: 'フォールド' };
  const label = (sc, a) => (sc.labels && sc.labels[a]) || ACTION_LABEL[a];
  const byId = id => SCENARIOS.find(s => s.id === id);
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ---------- タブ ----------
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === btn.dataset.tab));
    if (btn.dataset.tab === 'viewer') renderGrid(); // トレーナーで変わったスタックを表示用に戻す
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
  function reachNote(sc, h) {
    if (!sc.prior) return '';
    const r = sc.reach[h];
    if (r === 0) return '<p class="muted small">このハンドは前のアクションでレイズしないため、このスポットには到達しません。</p>';
    if (r < 1) return `<p class="muted small">到達頻度 ${pct(r)}（前のアクションで ${pct(r)} の頻度でレイズ）</p>`;
    return '';
  }
  function freqBar(s) {
    return `<div class="freq-bar">
      <div style="width:${s.raise * 100}%;background:var(--raise)"></div>
      <div style="width:${s.call * 100}%;background:var(--call)"></div></div>`;
  }
  const evText = x => (x >= 0 ? '+' : '') + x.toFixed(2) + 'bb';
  function evNote(sc, ev) {
    if (!ev) return '';
    return `<div class="ev-box"><div class="muted small">期待値 (EV)</div>${sc.actions.map(a =>
      `<div class="freq-row"><span>${label(sc, a)}</span><b>${evText(ev[a])}</b></div>`).join('')}</div>`;
  }
  function renderGrid() {
    const sc = byId($('viewerScenario').value);
    $('stackCtl').hidden = !sc.pushfold;
    if (sc.pushfold) PushFold.setStack(+$('viewerStack').value);
    const grid = $('grid'); grid.innerHTML = '';
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
      const h = gridHand(i, j), s = sc.strategy[h];
      const cell = document.createElement('div');
      cell.className = 'cell' + (sc.reach[h] === 0 ? ' out' : '');
      if (sc.reach[h] > 0 && sc.reach[h] < 1) cell.style.opacity = 0.45 + 0.55 * sc.reach[h];
      cell.innerHTML = `<div class="bar raise" style="width:${s.raise * 100}%"></div>
        <div class="bar call" style="width:${s.call * 100}%"></div><span>${h}</span>`;
      const show = () => {
        grid.querySelectorAll('.sel').forEach(c => c.classList.remove('sel'));
        cell.classList.add('sel');
        $('handInfo').innerHTML = `<h2>${h}</h2><div class="muted small">${combosOf(h)} コンボ</div>
          ${freqBar(s)}
          ${sc.actions.map(a => `<div class="freq-row"><span><i class="sw ${a}"></i>${label(sc, a)}</span><b>${pct(s[a])}</b></div>`).join('')}
          ${reachNote(sc, h)}${evNote(sc, sc.ev && sc.ev[h])}`;
      };
      cell.addEventListener('mouseenter', show);
      cell.addEventListener('click', show);
      grid.append(cell);
    }
    const st = rangeStats(sc);
    $('viewerStats').innerHTML = sc.actions.map(a => `<span><i class="sw ${a}"></i>${label(sc, a)} ${pct(st[a])}</span>`).join('')
      + (sc.prior ? '<span class="muted">※到達レンジ内の割合</span>' : '')
      + (sc.pushfold ? `<span class="solved">ナッシュ均衡（計算値）・可搾取度 ${(sc.exploitability * 1000).toFixed(2)} mbb/ハンド</span>` : '');
    $('viewerDesc').textContent = sc.desc || '';
    $('legendRaise').textContent = label(sc, 'raise');
    store.set('viewerScenario', sc.id);
  }
  $('viewerScenario').value = store.get('viewerScenario', 'BTN_RFI');
  if (!byId($('viewerScenario').value)) $('viewerScenario').value = 'BTN_RFI';
  for (let b = 2; b <= 25; b++) $('viewerStack').append(new Option(b, b));
  $('viewerStack').value = store.get('viewerStack', 10);
  $('viewerStack').addEventListener('change', () => { store.set('viewerStack', +$('viewerStack').value); renderGrid(); });
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
      let w = combosOf(h) * sc.reach[h];
      if (!w) return [h, 0];
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

  // ---------- テーブル表示（座席・人・チップ） ----------
  const ORDER = TableUI.ORDER;
  const POS_JA = { UTG: 'UTG', HJ: 'HJ', CO: 'CO', BTN: 'BTN (ボタン)', SB: 'SB (スモールブラインド)', BB: 'BB (ビッグブラインド)' };
  // シナリオごとの「ここまでの流れ」。ev = [座席, 行動, 合計ベット額]
  const SPOTS = {
    UTG_RFI: { hero: 'UTG', ev: [], raiseTo: 2.5 }, HJ_RFI: { hero: 'HJ', ev: [], raiseTo: 2.5 },
    CO_RFI: { hero: 'CO', ev: [], raiseTo: 2.5 }, BTN_RFI: { hero: 'BTN', ev: [], raiseTo: 2.5 },
    SB_RFI: { hero: 'SB', ev: [], raiseTo: 3 },
    BTN_vs_CO: { hero: 'BTN', ev: [['CO', 'raise', 2.5]], raiseTo: 7.5 },
    SB_vs_BTN: { hero: 'SB', ev: [['BTN', 'raise', 2.5]], raiseTo: 11 },
    BB_vs_BTN: { hero: 'BB', ev: [['BTN', 'raise', 2.5]], raiseTo: 11 },
    BB_vs_SB: { hero: 'BB', ev: [['SB', 'raise', 3]], raiseTo: 9 },
    UTG_vs_BTN3b: { hero: 'UTG', ev: [['UTG', 'raise', 2.5], ['BTN', 'raise', 7.5]], raiseTo: 19 },
    CO_vs_BTN3b: { hero: 'CO', ev: [['CO', 'raise', 2.5], ['BTN', 'raise', 7.5]], raiseTo: 19 },
    BTN_vs_BB3b: { hero: 'BTN', ev: [['BTN', 'raise', 2.5], ['BB', 'raise', 11]], raiseTo: 24 },
    SB_vs_BB3b: { hero: 'SB', ev: [['SB', 'raise', 3], ['BB', 'raise', 9]], raiseTo: 22 },
    BTN3b_vs_CO4b: { hero: 'BTN', ev: [['CO', 'raise', 2.5], ['BTN', 'raise', 7.5], ['CO', 'raise', 19]], raiseTo: 100 },
    SB3b_vs_BTN4b: { hero: 'SB', ev: [['BTN', 'raise', 2.5], ['SB', 'raise', 11], ['BTN', 'raise', 24]], raiseTo: 100 },
    BB3b_vs_BTN4b: { hero: 'BB', ev: [['BTN', 'raise', 2.5], ['BB', 'raise', 11], ['BTN', 'raise', 24]], raiseTo: 100 },
    SB_PF: { hero: 'SB', ev: [], hu: true },
    BB_vs_SB_PF: { hero: 'BB', ev: [['SB', 'allin', 'S']], hu: true },
  };
  const RAISE_NAME = ['オープン', '3ベット', '4ベット', '5ベット'];
  // 各席の状態を作る
  function tableState(sc, stack) {
    const spot = SPOTS[sc.id];
    const seats = spot.hu ? ['SB', 'BB'] : ORDER;
    const total = spot.hu ? stack : 100;
    const st = {};
    for (const p of seats) st[p] = { bet: p === 'SB' ? 0.5 : p === 'BB' ? 1 : 0, bubble: '', state: 'waiting' };
    if (!spot.hu) { st.SB.bubble = 'ブラインド'; st.BB.bubble = 'ブラインド'; }
    let raises = 0;
    const story = [];
    for (const [p, act, amt] of spot.ev) {
      const a = amt === 'S' ? stack : amt;
      st[p].bet = a; st[p].state = 'in';
      if (act === 'allin') { st[p].bubble = `オールイン ${a}bb`; story.push(`${p} が ${a}bb でオールイン`); }
      else { const nm = RAISE_NAME[raises++]; st[p].bubble = `${nm} ${a}bb`; story.push(`${p} が ${a}bb に${nm}`); }
    }
    const heroActed = spot.ev.some(e => e[0] === spot.hero);
    const hi = seats.indexOf(spot.hero), folded = [];
    seats.forEach((p, i) => {
      if (p === spot.hero) { st[p].state = 'hero'; return; }
      if (spot.ev.some(e => e[0] === p)) return;
      if (heroActed || i < hi || spot.hu) {
        if (!spot.hu) { st[p].state = 'folded'; st[p].bubble = 'フォールド'; folded.push(p); }
      }
    });
    for (const p of seats) st[p].stack = Math.max(0, total - st[p].bet);
    const pot = seats.reduce((a, p) => a + st[p].bet, 0);
    return { spot, seats, st, pot, story, folded };
  }
  function renderTable(sc, hand, suits, stack) {
    const T = tableState(sc, stack);
    const n = T.seats.length;
    const seats = TableUI.seatsFrom(T.spot.hero, T.seats).map(p => {
      const s = T.st[p], isHero = s.state === 'hero';
      return { pos: p, state: s.state, stack: s.stack, bet: s.bet, name: (isHero ? 'あなた・' : '') + p,
        bubble: isHero ? 'あなたの番' : s.bubble,
        cards: isHero ? `<div class="pk-hero-cards">${cardHTML(hand[0], suits[0])}${cardHTML(hand[1], suits[1])}</div>`
          : s.state !== 'folded' ? '<div class="pk-backs"><i></i><i></i></div>' : '' };
    });
    TableUI.render($('pkSeats'), seats, { dealer: n === 2 ? 'SB' : 'BTN' });
    $('pkPot').innerHTML = `ポット <b>${+T.pot.toFixed(1)}bb</b>`;
    $('pkTable').classList.toggle('hu', n === 2);
    return T;
  }
  // ボタンの説明（何をするアクションか）
  function actionHelp(sc, a, T, stack) {
    const spot = T.spot;
    if (a === 'fold') return 'このハンドを降りる';
    if (spot.hu) return a === 'raise' ? `${stack}bb 全部を賭ける` : `${stack}bb のオールインに付いていく`;
    const facing = Math.max(...T.seats.map(p => T.st[p].bet));
    if (a === 'call') return `${facing}bb に合わせて参加`;
    if (spot.raiseTo >= 100) return '100bb 全部を賭ける';
    return `${spot.raiseTo}bb にレイズ`;
  }
  // コーチの状況説明
  function situationText(sc, T, hand) {
    const spot = T.spot, me = spot.hero;
    const handTxt = `<b>${hand}</b>`;
    if (spot.hu) {
      return spot.ev.length
        ? `ヘッズアップ（2人だけ）で、スタックは ${sc.stack}bb。相手の SB が <b>${sc.stack}bb 全部を賭けて（オールイン）</b>きました。あなたは BB で手札は ${handTxt}。コールしますか、降りますか？`
        : `ヘッズアップ（2人だけ）で、スタックは ${sc.stack}bb。あなたは SB で手札は ${handTxt}。<b>全部賭ける（オールイン）か、降りるか</b>の2択です。`;
    }
    const parts = [];
    if (T.folded.length) parts.push(`${T.folded.join('・')} はフォールドしました`);
    parts.push(...T.story);
    const intro = parts.length ? parts.join('。') + '。' : 'あなたが一番最初に行動します。';
    let q;
    if (!spot.ev.length) q = `${parts.length ? `あなたは <b>${POS_JA[me]}</b> で、` : `ポジションは <b>${POS_JA[me]}</b>。`}まだ誰も参加していません。手札 ${handTxt} で<b>最初にレイズして参加するか</b>決めましょう。`;
    else if (spot.ev.length === 1) q = `あなたは <b>${POS_JA[me]}</b>。手札 ${handTxt} で、レイズ（3ベット）・コール・フォールドのどれにしますか？`;
    else if (spot.ev.length === 2) q = `あなたが最初にレイズしたら、<b>さらにレイズ（3ベット）</b>されました。手札 ${handTxt} でどうしますか？`;
    else q = `あなたの3ベットに、<b>さらにレイズ（4ベット）</b>が返ってきました。手札 ${handTxt} でどうしますか？`;
    return intro + '<br>' + q;
  }
  // コーチの解説（回答後）
  function coachFeedback(sc, hand, action, s, cls) {
    const acts = sc.actions.filter(a => s[a] > 0);
    const mix = acts.map(a => `${label(sc, a)} ${pct(s[a])}`).join('・');
    const best = sc.actions.reduce((x, a) => (s[a] > s[x] ? a : x), sc.actions[0]);
    const L = a => `<b>${label(sc, a)}</b>`;
    if (cls === 'good') {
      return s[action] >= 0.999 ? `正解！ ${hand} はこの場面で必ず ${L(action)} するハンドです。`
        : `正解！ ${hand} は ${mix} で使い分けるハンドで、${L(action)} が一番多い選択です。`;
    }
    if (cls === 'ok') return `悪くない選択です。${hand} は ${mix} で使い分けるハンドなので、${L(action)} も GTO が選ぶことがあります。一番多いのは ${L(best)} です。`;
    let why = '';
    if (best === 'fold') why = 'この場面で参加するには弱すぎるハンドです。';
    else if (action === 'fold') why = '降りるのはもったいない強さのハンドです。';
    else if (action === 'raise' && best === 'call') why = 'レイズするよりも、コールで付いていく方が得なハンドです。';
    else if (action === 'call' && best === 'raise') why = 'コールで済ませるより、レイズして主導権を取る方が得なハンドです。';
    return `惜しい！ ${hand} は ${L(best)} が正解です（GTO: ${mix}）。${why}`;
  }

  function newHand() {
    const sel = $('trainerScenario').value;
    const sc = sel === 'random' ? SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)] : byId(sel);
    if (sc.pushfold) PushFold.setStack(5 + Math.floor(Math.random() * 16)); // 5〜20bb をランダムに出題
    const hand = pickHand(sc);
    const suits = suitsFor(hand);
    current = { sc, hand, answered: false, strategy: sc.strategy, ev: sc.ev, name: sc.name + (sc.pushfold ? ` ${sc.stack}bb` : '') };
    $('spotName').innerHTML = `<span class="muted small">シナリオ</span> ${current.name}`;
    const T = renderTable(sc, hand, suits, sc.stack);
    current.T = T;
    $('coachMsg').innerHTML = situationText(sc, T, hand);
    $('actionButtons').innerHTML = '';
    sc.actions.forEach((a, k) => {
      const b = document.createElement('button');
      b.className = a; b.dataset.action = a;
      b.innerHTML = `<span class="pk-act-name">${label(sc, a)} <kbd>${k + 1}</kbd></span><span class="pk-act-help">${actionHelp(sc, a, T, sc.stack)}</span>`;
      b.addEventListener('click', () => answer(a));
      $('actionButtons').append(b);
    });
    $('feedback').innerHTML = '';
    $('nextHand').classList.add('hidden');
  }

  function answer(action) {
    if (!current || current.answered) return;
    current.answered = true;
    const s = current.strategy[current.hand];
    const best = Math.max(...current.sc.actions.map(a => s[a]));
    const f = s[action];
    const score = best > 0 ? f / best : 0;
    let verdict, cls;
    if (f === 0) { verdict = 'ミス ✗'; cls = 'bad'; }
    else if (f === best) { verdict = '正解 ✓'; cls = 'good'; }
    else { verdict = '許容範囲（混合戦略）'; cls = 'ok'; }

    stats.hands++; stats.score += score;
    if (cls === 'bad') { stats.blunders++; stats.streak = 0; } else stats.streak++;
    stats.history.unshift({ spot: current.name, hand: current.hand, action: label(current.sc, action), cls,
      gto: current.sc.actions.filter(a => s[a] > 0).map(a => `${label(current.sc, a)} ${pct(s[a])}`).join(' / ') });
    stats.history = stats.history.slice(0, 50);
    store.set('trainerStats', stats);

    document.querySelectorAll('#actionButtons button').forEach(b => {
      b.disabled = true; if (b.dataset.action === action) b.classList.add('chosen');
    });
    $('coachMsg').innerHTML = `<div class="verdict ${cls}">${verdict}</div>${coachFeedback(current.sc, current.hand, action, s, cls)}`;
    $('feedback').innerHTML = `<div class="muted small">GTO の頻度</div>
      ${freqBar(s)}
      ${current.sc.actions.map(a => `<div class="freq-row"><span>${label(current.sc, a)}</span><b>${pct(s[a])}</b></div>`).join('')}
      ${evNote(current.sc, current.ev && current.ev[current.hand])}`;
    $('nextHand').classList.remove('hidden');
    renderStats();
  }

  function renderStats() {
    $('sHands').textContent = stats.hands;
    $('sAcc').textContent = stats.hands ? (stats.score / stats.hands * 100).toFixed(1) + '%' : '–';
    $('sBlunder').textContent = stats.blunders;
    $('sStreak').textContent = stats.streak;
    $('history').innerHTML = stats.history.map(h =>
      `<li><span>${h.spot} — <b>${h.hand}</b> → <span class="${h.cls}">${ACTION_LABEL[h.action] || h.action}</span></span>
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
        const s = sc.strategy[h], w = (s.raise + s.call) * sc.reach[h];
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
