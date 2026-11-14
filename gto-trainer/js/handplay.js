// ハンド練習: プリフロップからショーダウンまで1ハンドを通して練習する
// フロップ以降は「相手のベットレンジに対する自分のエクイティ」と「ポットオッズ」でコール/フォールドを判定する。
(function () {
  const { SCENARIOS, combosOf, handCombos, ALL_HANDS } = Ranges;
  const E = Evaluator;
  const $ = id => document.getElementById(id);
  const byId = id => SCENARIOS.find(s => s.id === id);
  const pct = x => (x * 100).toFixed(1) + '%';
  const bb = x => (Math.round(x * 10) / 10).toFixed(1) + 'bb';
  const evText = x => (x >= 0 ? '+' : '') + x.toFixed(2) + 'bb';
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // あなたがオープンにコールしてフロップに進むシチュエーション
  const SPOTS = [
    { id: 'BB_vs_BTN', villain: 'BTN_RFI', hero: 'BB', vill: 'BTN', pot: 5.5, invested: 2.5, heroIP: false,
      text: 'BTN が 2.5bb オープン、SB フォールド → あなた (BB)' },
    { id: 'BTN_vs_CO', villain: 'CO_RFI', hero: 'BTN', vill: 'CO', pot: 6.5, invested: 2.5, heroIP: true,
      text: 'CO が 2.5bb オープン → あなた (BTN)' },
    { id: 'BB_vs_SB', villain: 'SB_RFI', hero: 'BB', vill: 'SB', pot: 6, invested: 3, heroIP: true,
      text: 'SB が 3bb オープン → あなた (BB)' },
  ];
  const STREETS = ['プリフロップ', 'フロップ', 'ターン', 'リバー'];
  const BOARD_LEN = [0, 3, 4, 5];
  const BET_SIZES = [0.33, 0.5, 0.75, 1.0];
  const VALUE_SHARE = { 3: 0.42, 4: 0.33, 5: 0.25 };   // 相手がバリューベットするレンジ上位の割合
  const BLUFF_MULT = { 3: 1.6, 4: 1.3, 5: 1.0 };       // ブラフ比率の係数（リバーは理論値 s/(1+2s)）
  const SUIT_SYM = ['♠', '♥', '♦', '♣'];
  const SUIT_CLASS = ['', 'red', 'blue', 'green'];
  const RANK_TXT = r => '23456789TJQKA'[r].replace('T', '10');

  let st = null;
  let stats = store.get('handStats', { hands: 0, decisions: 0, good: 0, evLoss: 0 });

  // ---------- 表示 ----------
  function cardHTML(c) {
    return `<div class="card ${SUIT_CLASS[c & 3]}">${RANK_TXT(c >> 2)}<small>${SUIT_SYM[c & 3]}</small></div>`;
  }
  const backHTML = () => '<div class="card back"></div>';
  const slotHTML = () => '<div class="card slot"></div>';
  function renderTable() {
    const n = BOARD_LEN[st.street];
    $('hpBoard').innerHTML = st.board.slice(0, n).map(cardHTML).join('') + Array(5 - n).fill(0).map(slotHTML).join('');
    $('hpHeroCards').innerHTML = st.hero.map(cardHTML).join('');
    $('hpVillCards').innerHTML = st.showdown ? st.vill.map(cardHTML).join('') : backHTML() + backHTML();
    $('hpPot').textContent = `ポット ${bb(st.pot)}　残りスタック ${bb(st.stack)}`;
    $('hpHeroSeat').textContent = `あなた (${st.spot.hero})`;
    $('hpVillSeat').textContent = `相手 (${st.spot.vill})`;
    $('hpLog').innerHTML = st.log.map(l => `<li><span>${l.text}</span>${l.res ? `<span class="${l.cls}">${l.res}</span>` : ''}</li>`).join('');
  }
  function setButtons(list) {
    $('hpActions').innerHTML = '';
    list.forEach(([text, cls, fn], k) => {
      const b = document.createElement('button');
      b.className = cls; b.textContent = `${text} (${k + 1})`;
      b.addEventListener('click', fn);
      $('hpActions').append(b);
    });
  }
  function setNext(text, fn) {
    const n = $('hpNext');
    if (!text) { n.hidden = true; n.onclick = null; return; }
    n.hidden = false; n.textContent = text + ' (Space)'; n.onclick = fn;
  }
  function renderStats() {
    $('hpHands').textContent = stats.hands;
    $('hpAcc').textContent = stats.decisions ? (stats.good / stats.decisions * 100).toFixed(1) + '%' : '–';
    $('hpDec').textContent = stats.decisions;
    $('hpLoss').textContent = !stats.decisions ? '–' : stats.evLoss >= 0.05 ? '-' + stats.evLoss.toFixed(1) + 'bb' : '0.0bb';
  }

  // ---------- レンジ処理 ----------
  function weightedPick(items, wOf) {
    const total = items.reduce((a, x) => a + wOf(x), 0);
    let x = Math.random() * total;
    for (const it of items) if ((x -= wOf(it)) <= 0) return it;
    return items[items.length - 1];
  }
  const blocked = (c, dead) => dead.has(c[0]) || dead.has(c[1]);

  function hasDraw(c, board) {
    if (board.length >= 5) return false;
    const cards = [c[0], c[1], ...board];
    for (let s = 0; s < 4; s++) {
      const n = cards.filter(x => (x & 3) === s).length;
      if (n === 4 && ((c[0] & 3) === s || (c[1] & 3) === s)) return true;
    }
    let mask = 0; for (const x of cards) mask |= 1 << (x >> 2);
    const m = (mask << 1) | ((mask >> 12) & 1);
    const hole = ((1 << (c[0] >> 2)) | (1 << (c[1] >> 2))) << 1;
    for (let lo = 0; lo <= 10; lo++) {
      const w = 0xf << lo;
      if ((m & w) === w && (hole & w)) return true;
    }
    return false;
  }

  // 相手のレンジを「ベット（バリュー＋ブラフ）」と「チェック」に分ける
  function splitRange(range, board, size) {
    const scored = range.map(c => ({ c, score: E.eval7([c[0], c[1], ...board]), draw: hasDraw(c, board) }))
      .sort((a, b) => b.score - a.score);
    const total = scored.reduce((a, x) => a + x.c[2], 0);
    const bet = new Set(); let valueW = 0;
    for (const x of scored) { if (valueW >= VALUE_SHARE[board.length] * total) break; bet.add(x); valueW += x.c[2]; }
    const r = Math.min(0.45, size / (1 + 2 * size) * BLUFF_MULT[board.length]);
    const bluffTarget = valueW * r / (1 - r);
    const rest = scored.filter(x => !bet.has(x));
    const cands = [...rest.filter(x => x.draw), ...rest.filter(x => !x.draw).reverse()];
    let bluffW = 0;
    for (const x of cands) { if (bluffW >= bluffTarget) break; bet.add(x); bluffW += x.c[2]; }
    return {
      bet: scored.filter(x => bet.has(x)).map(x => x.c),
      check: scored.filter(x => !bet.has(x)).map(x => x.c),
    };
  }
  const key = c => Math.min(c[0], c[1]) + '-' + Math.max(c[0], c[1]);

  // ---------- 進行 ----------
  function newHand() {
    const sel = $('hpSpot').value;
    const spot = sel === 'random' ? SPOTS[Math.floor(Math.random() * SPOTS.length)] : SPOTS.find(s => s.id === sel);
    const sc = byId(spot.id), vsc = byId(spot.villain);
    // あなたのハンド: コールするハンドから（コール頻度で重み付け）
    const hand = weightedPick(ALL_HANDS.filter(h => sc.strategy[h].call > 0), h => combosOf(h) * sc.strategy[h].call);
    const hc = handCombos(hand); const hero = hc[Math.floor(Math.random() * hc.length)];
    let dead = new Set(hero);
    // 相手のレンジ: オープンレンジのコンボ（あなたのカードと重なるものを除く）
    let range = [];
    for (const h of ALL_HANDS) {
      const w = vsc.strategy[h].raise;
      if (w > 0) for (const c of handCombos(h)) if (!blocked(c, dead)) range.push([c[0], c[1], w]);
    }
    const vc = weightedPick(range, c => c[2]);
    const vill = [vc[0], vc[1]];
    dead = new Set([...hero, ...vill]);
    const deck = []; for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    st = { spot, sc, hand, hero, vill, board: deck.slice(0, 5), range, street: 0,
      pot: spot.pot, stack: 100 - spot.invested, log: [], showdown: false, loss: 0 };
    stats.hands++; store.set('handStats', stats); renderStats();
    $('hpStreet').innerHTML = `プリフロップ<div class="spot-desc">${spot.text}　あなたの判断は？</div>`;
    $('hpFeedback').innerHTML = '';
    setNext(null);
    setButtons(sc.actions.map(a => [actionLabel(sc, a), a, () => preflopAnswer(a)]));
    renderTable();
  }
  function actionLabel(sc, a) {
    return (sc.labels && sc.labels[a]) || { raise: 'レイズ', call: 'コール', fold: 'フォールド' }[a];
  }

  function preflopAnswer(a) {
    const s = st.sc.strategy[st.hand];
    const best = Math.max(...st.sc.actions.map(x => s[x]));
    const cls = s[a] === 0 ? 'bad' : s[a] === best ? 'good' : 'ok';
    const verdict = { good: '正解 ✓', ok: '許容範囲（混合戦略）', bad: 'ミス ✗' }[cls];
    stats.decisions++; if (cls !== 'bad') stats.good++;
    store.set('handStats', stats); renderStats();
    st.log.push({ text: `プリフロップ: ${st.hand} で${actionLabel(st.sc, a)}`, res: verdict, cls });
    $('hpActions').innerHTML = '';
    $('hpFeedback').innerHTML = `<div class="verdict ${cls}">${verdict}</div>
      ${st.sc.actions.map(x => `<div class="freq-row"><span>${actionLabel(st.sc, x)}</span><b>${(s[x] * 100).toFixed(0)}%</b></div>`).join('')}
      ${a !== 'call' ? '<p class="muted small">練習のため、ここからはコールしたものとしてフロップに進みます。</p>' : ''}`;
    renderTable();
    setNext('フロップへ', () => startStreet(1));
  }

  function startStreet(street) {
    st.street = street;
    const board = st.board.slice(0, BOARD_LEN[street]);
    const dead = new Set([...st.hero, ...board]);
    st.range = st.range.filter(c => !blocked(c, dead));
    $('hpFeedback').innerHTML = '';
    $('hpActions').innerHTML = '';
    const lead = st.spot.heroIP ? '' : 'あなたはチェック。';
    if (st.stack <= 0) { // オールイン済み
      st.log.push({ text: `${STREETS[street]}: オールイン済みのためカードを開くだけ` });
      renderTable();
      return street < 3 ? setNext(`${STREETS[street + 1]}へ`, () => startStreet(street + 1)) : setNext('ショーダウン', showdown);
    }
    const size = BET_SIZES[Math.floor(Math.random() * BET_SIZES.length)];
    const bet = Math.min(Math.round(size * st.pot * 10) / 10, st.stack);
    const split = splitRange(st.range, board, bet / st.pot);
    const bets = split.bet.some(c => key(c) === key(st.vill));
    renderTable();
    if (!bets) {
      st.range = split.check;
      st.log.push({ text: `${STREETS[street]}: ${lead}相手はチェック` });
      $('hpStreet').innerHTML = `${STREETS[street]}<div class="spot-desc">${lead}相手はチェックしました</div>`;
      calcLater(() => E.equity(st.hero, st.range, board, 8000), r => {
        $('hpFeedback').innerHTML = `<p class="muted">相手のチェックレンジに対するあなたのエクイティ: <b>${pct(r.equity)}</b></p>`;
      });
      renderTable();
      return street < 3 ? setNext(`チェックして${STREETS[street + 1]}へ`, () => startStreet(street + 1)) : setNext('チェックしてショーダウン', showdown);
    }
    st.pending = { bet, size: bet / st.pot, betRange: split.bet, board };
    $('hpStreet').innerHTML = `${STREETS[street]}<div class="spot-desc">${lead}相手が <b>${bb(bet)}</b>（ポットの${Math.round(bet / st.pot * 100)}%）ベット</div>`;
    setButtons([['コール', 'call', () => decide('call')], ['フォールド', 'fold', () => decide('fold')]]);
  }

  function calcLater(fn, done) {
    $('hpFeedback').innerHTML = '<p class="muted">計算中…</p>';
    setTimeout(() => done(fn()), 20);
  }

  function decide(choice) {
    const p = st.pending; if (!p || p.done) return;
    p.done = true;
    document.querySelectorAll('#hpActions button').forEach(b => { b.disabled = true; if (b.className === choice) b.classList.add('chosen'); });
    calcLater(() => E.equity(st.hero, p.betRange, p.board, 15000), r => {
      const need = p.bet / (st.pot + 2 * p.bet);
      const evCall = r.equity * (st.pot + 2 * p.bet) - p.bet; // フォールド(0)との差
      const best = evCall >= 0 ? 'call' : 'fold';
      const loss = choice === best ? 0 : Math.abs(evCall);
      const cls = loss === 0 ? 'good' : loss < 0.25 ? 'ok' : 'bad';
      const verdict = { good: '正解 ✓', ok: '僅差（ほぼ同じEV）', bad: 'ミス ✗' }[cls];
      stats.decisions++; if (cls !== 'bad') stats.good++; stats.evLoss += loss; st.loss += loss;
      store.set('handStats', stats); renderStats();
      st.log.push({ text: `${STREETS[st.street]}: 相手 ${bb(p.bet)} ベット → ${choice === 'call' ? 'コール' : 'フォールド'}（必要 ${pct(need)} / あなた ${pct(r.equity)}）`, res: verdict, cls });
      const pot = st.pot;
      $('hpFeedback').innerHTML = `<div class="verdict ${cls}">${verdict}</div>
        <div class="eq-compare">
          <div><span class="muted small">必要なエクイティ</span><b>${pct(need)}</b><span class="muted small">${bb(p.bet)} ÷ (${bb(pot)} + ${bb(p.bet)}×2)</span></div>
          <div><span class="muted small">あなたのエクイティ</span><b class="${evCall >= 0 ? 'pos' : 'neg'}">${pct(r.equity)}</b><span class="muted small">相手のベットレンジ ${p.betRange.length} コンボに対して</span></div>
        </div>
        <div class="freq-row"><span>コールのEV</span><b>${evText(evCall)}</b></div>
        <div class="freq-row"><span>フォールドのEV</span><b>${evText(0)}</b></div>`;
      // 練習のため、フォールドしてもコールしたものとして続行
      st.pot += 2 * p.bet; st.stack -= p.bet; st.range = p.betRange; st.pending = null;
      renderTable();
      const cont = choice === 'fold' ? '（コールしたものとして）' : '';
      if (st.street < 3) setNext(`${STREETS[st.street + 1]}へ${cont}`, () => startStreet(st.street + 1));
      else setNext(`ショーダウン${cont}`, showdown);
    });
  }

  function showdown() {
    st.showdown = true; st.street = 3;
    const h = E.eval7([...st.hero, ...st.board]), v = E.eval7([...st.vill, ...st.board]);
    const res = h > v ? ['あなたの勝ち', 'good'] : h < v ? ['相手の勝ち', 'bad'] : ['引き分け', 'ok'];
    st.log.push({ text: `ショーダウン: あなた ${E.category(h)} / 相手 ${E.category(v)}`, res: res[0], cls: res[1] });
    $('hpStreet').innerHTML = `ショーダウン<div class="spot-desc">相手の手札は ${st.vill.map(E.cardToString).join(' ')}</div>`;
    $('hpActions').innerHTML = '';
    $('hpFeedback').innerHTML = `<div class="verdict ${res[1]}">${res[0]}</div>
      <div class="freq-row"><span>あなた</span><b>${E.category(h)}</b></div>
      <div class="freq-row"><span>相手</span><b>${E.category(v)}</b></div>
      <div class="freq-row"><span>ポット</span><b>${bb(st.pot)}</b></div>
      <div class="freq-row"><span>このハンドの判断ミスによるEV損失</span><b>${st.loss ? '-' + st.loss.toFixed(2) + 'bb' : 'なし'}</b></div>
      <p class="muted small">勝ち負けは運の要素を含みます。判断の良し悪しはEVで見てください。</p>`;
    renderTable();
    setNext('次のハンド', newHand);
  }

  // ---------- 初期化 ----------
  for (const s of SPOTS) $('hpSpot').append(new Option(s.text.replace(/ → あなた.*$/, '') + `（あなた ${s.hero}）`, s.id));
  $('hpSpot').addEventListener('change', newHand);
  $('hpReset').addEventListener('click', () => {
    stats = { hands: 0, decisions: 0, good: 0, evLoss: 0 }; store.set('handStats', stats); renderStats();
  });
  document.addEventListener('keydown', e => {
    if (!$('hand').classList.contains('active') || e.target.matches('input, select')) return;
    if ((e.code === 'Space' || e.code === 'Enter') && !$('hpNext').hidden) { e.preventDefault(); $('hpNext').click(); return; }
    const n = parseInt(e.key, 10);
    const btns = $('hpActions').querySelectorAll('button:not(:disabled)');
    if (n >= 1 && btns[n - 1]) btns[n - 1].click();
  });
  renderStats();
  newHand();
})();
