// ハンド練習: プリフロップからショーダウンまで1ハンドを通して練習する
// フロップ以降は「相手のベットレンジに対する自分のエクイティ」と「ポットオッズ」でコール/フォールドを判定する。
(function () {
  const { SCENARIOS, combosOf, handCombos, ALL_HANDS } = Ranges;
  const E = Evaluator;
  const $ = id => document.getElementById(id);
  const byId = id => SCENARIOS.find(s => s.id === id);
  const pct = x => (x * 100).toFixed(1) + '%';
  const pct0 = x => Math.round(x * 100) + '%';
  const bb = x => (Math.round(x * 10) / 10).toFixed(1) + 'bb';
  const evText = x => (x >= 0 ? '+' : '') + x.toFixed(2) + 'bb';
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // あなたがオープンにコールしてフロップに進むシチュエーション
  const SPOTS = [
    { id: 'BB_vs_BTN', villain: 'BTN_RFI', hero: 'BB', vill: 'BTN', pot: 5.5, invested: 2.5, heroIP: false,
      open: 2.5, raiseTo: 11, waiting: [], name: 'BTN オープン vs あなた (BB)' },
    { id: 'BTN_vs_CO', villain: 'CO_RFI', hero: 'BTN', vill: 'CO', pot: 6.5, invested: 2.5, heroIP: true,
      open: 2.5, raiseTo: 7.5, waiting: ['SB', 'BB'], name: 'CO オープン vs あなた (BTN)' },
    { id: 'BB_vs_SB', villain: 'SB_RFI', hero: 'BB', vill: 'SB', pot: 6, invested: 3, heroIP: true,
      open: 3, raiseTo: 9, waiting: [], name: 'SB オープン vs あなた (BB)' },
  ];
  const POS_JA = { UTG: 'UTG', HJ: 'HJ', CO: 'CO', BTN: 'BTN（ボタン）', SB: 'SB（スモールブラインド）', BB: 'BB（ビッグブラインド）' };
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
  const slotHTML = () => '<div class="card slot"></div>';
  const cardText = c => `<span class="mini-card ${SUIT_CLASS[c & 3]}">${RANK_TXT(c >> 2)}${SUIT_SYM[c & 3]}</span>`;
  const BACKS = '<div class="pk-backs"><i></i><i></i></div>';
  const curBoard = () => st.board.slice(0, BOARD_LEN[st.street]);
  function madeHand() {
    const b = curBoard();
    if (!b.length) return '';
    const cat = E.category(E.eval7([...st.hero, ...b]));
    return `<b>${cat}</b>${hasDraw(st.hero, b) ? '（さらにフラッシュかストレートのドローあり）' : ''}`;
  }
  function renderTable() {
    const spot = st.spot, pre = st.street === 0 && !st.showdown;
    const n = BOARD_LEN[st.street];
    $('hpBoard').innerHTML = st.board.slice(0, n).map(cardHTML).join('') + Array(5 - n).fill(0).map(slotHTML).join('');
    const blindOf = p => (p === 'SB' ? 0.5 : p === 'BB' ? 1 : 0);
    const heroBet = pre ? blindOf(spot.hero) : st.bets.hero, villBet = pre ? spot.open : st.bets.vill;
    let tableBets = 0;
    const seats = TableUI.seatsFrom(spot.hero).map(p => {
      if (p === spot.hero) {
        tableBets += heroBet;
        return { pos: p, state: 'hero', name: 'あなた・' + p, stack: (pre ? 100 - heroBet : st.stack - heroBet), bet: heroBet,
          bubble: st.heroTurn ? 'あなたの番' : st.hAct, bubbleCls: st.heroTurn ? 'hero' : 'in',
          cards: `<div class="pk-hero-cards">${st.hero.map(cardHTML).join('')}</div>` };
      }
      if (p === spot.vill) {
        tableBets += villBet;
        return { pos: p, state: 'in', name: '相手・' + p, stack: (pre ? 100 - villBet : st.stack - villBet), bet: villBet,
          bubble: st.vAct, bubbleCls: st.vAct === 'フォールド' ? 'folded' : 'in',
          cards: st.showdown ? `<div class="pk-hero-cards small">${st.vill.map(cardHTML).join('')}</div>` : BACKS };
      }
      const waiting = pre && spot.waiting.includes(p);
      const blind = pre ? blindOf(p) : 0;
      tableBets += blind;
      return { pos: p, state: waiting ? 'waiting' : 'folded', name: p, stack: 100 - blindOf(p), bet: blind,
        bubble: pre ? (waiting ? 'ブラインド' : 'フォールド') : '', cards: waiting ? BACKS : '' };
    });
    TableUI.render($('hpSeats'), seats, { dealer: 'BTN' });
    const pot = pre ? tableBets : st.pot + st.bets.hero + st.bets.vill;
    $('hpPot').innerHTML = `ポット <b>${+pot.toFixed(1)}bb</b>`;
    $('hpTitle').innerHTML = `<span class="muted small">シチュエーション</span> ${spot.name}・<b>${st.showdown ? '結果' : STREETS[st.street]}</b>`;
    $('hpLog').innerHTML = st.log.map(l => `<li><span>${l.text}</span>${l.res ? `<span class="${l.cls}">${l.res}</span>` : ''}</li>`).join('');
  }
  const coach = html => { $('hpCoachMsg').innerHTML = html; };
  function details(html) {
    $('hpFeedback').innerHTML = html || '';
    $('hpDetails').hidden = !html;
  }
  // list: [名前, 色クラス, 処理, 説明]
  function setButtons(list) {
    $('hpActions').innerHTML = '';
    list.forEach(([text, cls, fn, help], k) => {
      const b = document.createElement('button');
      b.className = cls;
      b.innerHTML = `<span class="pk-act-name">${text} <kbd>${k + 1}</kbd></span><span class="pk-act-help">${help || ''}</span>`;
      b.addEventListener('click', () => { if (!b.disabled) fn(); });
      $('hpActions').append(b);
    });
  }
  function lockButtons(idx) {
    document.querySelectorAll('#hpActions button').forEach((b, i) => { b.disabled = true; if (i === idx) b.classList.add('chosen'); });
  }
  function setNext(text, fn) {
    const n = $('hpNext');
    if (!text) { n.hidden = true; n.onclick = null; return; }
    n.hidden = false; n.textContent = text + ' (Space)';
    n.onclick = () => { n.hidden = true; n.onclick = null; fn(); };
  }
  function renderStats() {
    $('hpHands').textContent = stats.hands;
    $('hpAcc').textContent = stats.decisions ? (stats.good / stats.decisions * 100).toFixed(1) + '%' : '–';
    $('hpDec').textContent = stats.decisions;
    $('hpLoss').textContent = !stats.decisions ? '–' : stats.evLoss >= 0.05 ? '-' + stats.evLoss.toFixed(1) + 'bb' : '0.0bb';
  }
  const VERDICT = { good: '正解 ✓', ok: '僅差（ほぼ同じ得）', bad: 'ミス ✗' };
  const verdictHTML = cls => `<div class="verdict ${cls}">${VERDICT[cls]}</div>`;

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
      pot: spot.pot, stack: 100 - spot.invested, log: [], showdown: false, loss: 0,
      bets: { hero: 0, vill: 0 }, hAct: '', vAct: `オープン ${spot.open}bb`, heroTurn: true };
    stats.hands++; store.set('handStats', stats); renderStats();
    details(''); setNext(null);
    const others = TableUI.ORDER.filter(p => p !== spot.hero && p !== spot.vill && !spot.waiting.includes(p));
    coach(`${others.join('・')} はフォールド。<b>${spot.vill} が ${spot.open}bb にオープン</b>（最初のレイズ）しました。` +
      (spot.waiting.length ? `${spot.waiting.join(' と ')} はまだ行動していません。` : '') +
      `<br>あなたは <b>${POS_JA[spot.hero]}</b> で、手札は <b>${hand}</b>。3ベット・コール・フォールドのどれにしますか？`);
    setButtons(sc.actions.map(a => [actionLabel(sc, a), a, () => preflopAnswer(a),
      a === 'raise' ? `${spot.raiseTo}bb にレイズし返す` : a === 'call' ? `${spot.open}bb に合わせて参加` : 'このハンドを降りる']));
    renderTable();
  }
  function actionLabel(sc, a) {
    return (sc.labels && sc.labels[a]) || { raise: 'レイズ', call: 'コール', fold: 'フォールド' }[a];
  }

  function preflopAnswer(a) {
    if (!st.heroTurn) return;
    const s = st.sc.strategy[st.hand];
    const best = st.sc.actions.reduce((x, y) => (s[y] > s[x] ? y : x), st.sc.actions[0]);
    const cls = s[a] === 0 ? 'bad' : s[a] === s[best] ? 'good' : 'ok';
    stats.decisions++; if (cls !== 'bad') stats.good++;
    store.set('handStats', stats); renderStats();
    st.log.push({ text: `プリフロップ: ${st.hand} で${actionLabel(st.sc, a)}`, res: VERDICT[cls], cls });
    lockButtons(st.sc.actions.indexOf(a));
    st.heroTurn = false; st.hAct = actionLabel(st.sc, a);
    const mix = st.sc.actions.filter(x => s[x] > 0).map(x => `${actionLabel(st.sc, x)} ${pct0(s[x])}`).join('・');
    let msg = cls === 'good' ? `${st.hand} はこの場面で <b>${actionLabel(st.sc, a)}</b> が一番多い選択です（GTO: ${mix}）。`
      : cls === 'ok' ? `${st.hand} は ${mix} で使い分けるハンドなので、今の選択も GTO が選ぶことがあります。一番多いのは <b>${actionLabel(st.sc, best)}</b> です。`
      : `${st.hand} は <b>${actionLabel(st.sc, best)}</b> が正解です（GTO: ${mix}）。`;
    msg += a === 'call' ? '<br>コールしてフロップに進みます。' : '<br>練習のため、ここからは <b>コールした</b>ものとしてフロップに進みます。';
    coach(verdictHTML(cls) + msg);
    details(`<div class="muted small">GTO の頻度</div>${st.sc.actions.map(x => `<div class="freq-row"><span>${actionLabel(st.sc, x)}</span><b>${pct0(s[x])}</b></div>`).join('')}`);
    renderTable();
    setNext('フロップへ', () => startStreet(1));
  }

  function startStreet(street) {
    st.street = street;
    const board = curBoard();
    const dead = new Set([...st.hero, ...board]);
    st.range = st.range.filter(c => !blocked(c, dead));
    st.bets = { hero: 0, vill: 0 }; st.hAct = ''; st.vAct = ''; st.heroTurn = false;
    $('hpActions').innerHTML = ''; details(''); setNext(null);
    const newCards = street === 1 ? board : board.slice(-1);
    st.intro = `${STREETS[street]}で ${newCards.map(cardText).join(' ')} が開きました。ポットは ${bb(st.pot)}、あなたは今 ${madeHand()} です。<br>`;
    renderTable();
    if (st.stack <= 0) { // オールイン済み
      st.log.push({ text: `${STREETS[street]}: オールイン済みのためカードを開くだけ` });
      coach(st.intro + 'もう全部賭けているので、カードを開くだけです。');
      renderTable();
      return nextStreet('');
    }
    // OOP なら先にあなたが行動、IP なら相手が先に行動
    if (st.spot.heroIP) villainAct(street, board, st.intro);
    else heroOption(street, board, st.intro + 'あなたが先に行動します。');
  }
  function nextStreet(prefix) {
    if (st.street < 3) setNext(`${prefix}${STREETS[st.street + 1]}へ`, () => startStreet(st.street + 1));
    else setNext(`${prefix}ショーダウン`, showdown);
  }

  // 相手の行動（ベット or チェック）。lead はそれまでの流れの説明
  function villainAct(street, board, lead) {
    const size = BET_SIZES[Math.floor(Math.random() * BET_SIZES.length)];
    const bet = Math.min(Math.round(size * st.pot * 10) / 10, st.stack);
    const split = splitRange(st.range, board, bet / st.pot);
    const bets = split.bet.some(c => key(c) === key(st.vill));
    $('hpActions').innerHTML = ''; setNext(null);
    if (!bets) {
      st.range = split.check; st.vAct = 'チェック';
      if (st.spot.heroIP) { // 相手チェック → あなたの番
        st.log.push({ text: `${STREETS[street]}: 相手はチェック` });
        renderTable();
        return heroOption(street, board, lead + '相手は<b>チェック</b>（賭けずに回す）しました。');
      }
      st.log.push({ text: `${STREETS[street]}: 相手もチェック` });
      coach(`${lead}相手も<b>チェック</b>しました。お互い賭けずに、次のカードへ進みます。`);
      renderTable();
      return nextStreet('');
    }
    st.pending = { bet, size: bet / st.pot, betRange: split.bet, board };
    st.vAct = `ベット ${+bet.toFixed(1)}bb`; st.bets.vill = bet; st.heroTurn = true;
    coach(`${lead}相手が <b>${bb(bet)}</b>（ポットの${Math.round(bet / st.pot * 100)}%）を<b>ベット</b>してきました。<br>` +
      `コールするには ${bb(bet)} 払います。勝てばポットの ${bb(st.pot + 2 * bet)} が手に入ります。降りるとここまでのポットは相手のものです。`);
    renderTable();
    setButtons([['コール', 'call', () => decide('call'), `${bb(bet)} 払って続ける`],
      ['フォールド', 'fold', () => decide('fold'), '降りる（ポットは相手に）']]);
  }

  // 相手がベットに対してディフェンスするレンジ（最小ディフェンス頻度 MDF = ポット ÷ (ポット + ベット) まで、強い順。ドローはワンペア相当として扱う）
  const DRAW_SCORE = (1 << 20) | (6 << 16);
  function defendRange(range, board, B, pot) {
    const mdf = pot / (pot + B);
    const scored = range.map(c => {
      const sc = E.eval7([c[0], c[1], ...board]);
      return { c, k: hasDraw(c, board) ? Math.max(sc, DRAW_SCORE) : sc };
    }).sort((a, b) => b.k - a.k);
    const total = scored.reduce((a, x) => a + x.c[2], 0);
    const out = []; let w = 0;
    for (const x of scored) { if (w >= mdf * total) break; out.push(x.c); w += x.c[2]; }
    return { calls: out, foldFreq: 1 - w / total };
  }

  // あなたの行動: チェック or ベット
  function heroOption(street, board, lead) {
    const sizes = [0.33, 0.75, 1.25].map(f => Math.min(Math.round(f * st.pot * 10) / 10, st.stack))
      .filter((b, i, arr) => b > 0 && arr.indexOf(b) === i);
    st.heroPending = { board, lead, sizes, done: false };
    st.heroTurn = true;
    coach(`${lead}<br>あなたの番です。<b>チェック</b>（賭けずに次へ）か、<b>ベット</b>（チップを賭ける）を選んでください。` +
      `強い手はベットして増やし、弱い手でも相手を降ろせそうならベットが有効です。`);
    renderTable();
    setButtons([['チェック', 'check', () => heroDecide(-1), '賭けずに次へ'],
      ...sizes.map((b, i) => [`ベット ${bb(b)}`, 'raise', () => heroDecide(i), b >= st.stack ? '全部賭ける（オールイン）' : `ポットの${Math.round(b / st.pot * 100)}%を賭ける`])]);
  }

  function heroDecide(idx) {
    const hp = st.heroPending; if (!hp || hp.done) return;
    hp.done = true;
    lockButtons(idx + 1);
    const pot = st.pot, board = hp.board;
    calcLater(() => {
      const eqAll = E.equity(st.hero, st.range, board, 10000).equity;
      const opts = [{ label: 'チェック', ev: eqAll * pot, eq: eqAll, fold: null }];
      for (const B of hp.sizes) {
        const d = defendRange(st.range, board, B, pot);
        const eqC = d.calls.length ? E.equity(st.hero, d.calls, board, 10000).equity : 0;
        opts.push({ label: `ベット ${bb(B)}`, B, ev: d.foldFreq * pot + (1 - d.foldFreq) * (eqC * (pot + 2 * B) - B),
          eq: eqC, fold: d.foldFreq, calls: d.calls });
      }
      return opts;
    }, opts => {
      const bestEV = Math.max(...opts.map(o => o.ev));
      const mine = opts[idx + 1];
      const loss = bestEV - mine.ev;
      const cls = loss < 1e-9 ? 'good' : loss < 0.25 ? 'ok' : 'bad';
      stats.decisions++; if (cls !== 'bad') stats.good++; stats.evLoss += loss; st.loss += loss;
      store.set('handStats', stats); renderStats();
      const best = opts.find(o => o.ev === bestEV);
      st.log.push({ text: `${STREETS[st.street]}: あなたは${mine.label}${cls !== 'good' ? `（最善: ${best.label}）` : ''}`, res: VERDICT[cls], cls });
      st.heroTurn = false; st.hAct = mine.label;
      let msg = `一番得なのは <b>${best.label}</b> です。`;
      if (best.fold === null) msg += 'ベットしても降りてくれるのは弱い手が中心で、強い手にはコールされてしまうので、ここは賭けずに進むのが得です。';
      else msg += `${best.label} すると相手は約 ${pct0(best.fold)} の確率で降り、コールされても勝率が ${pct0(best.eq)} あるので、合計で一番得になります。`;
      if (cls !== 'good') msg += `<br>あなたの選択（${mine.label}）との差は <b>${loss.toFixed(2)}bb</b> です。`;
      details(`<div class="opt-table-wrap"><table class="opt-table">
          <thead><tr><th>選択肢</th><th>相手が降りる確率</th><th>勝率</th><th>期待値 (EV)</th></tr></thead>
          <tbody>${opts.map(o => `<tr class="${o === mine ? 'mine' : ''} ${o.ev === bestEV ? 'best' : ''}">
            <td>${o.label}${o.ev === bestEV ? ' ★' : ''}</td><td>${o.fold === null ? '–' : pct(o.fold)}</td>
            <td>${pct(o.eq)}${o.fold === null ? '' : '<span class="muted small"> (コールされた時)</span>'}</td>
            <td>${o.ev.toFixed(2)}bb</td></tr>`).join('')}</tbody></table></div>
        <p class="muted small">期待値 = このあとポットから平均で得られる額。チェック = 勝率 × ポット（以降チェックで進むと仮定）。
        ベット = 降りる確率 × ポット + コール率 × (勝率 × (ポット + ベット×2) − ベット)。相手は最小ディフェンス頻度まで強い順（ドロー含む）にコールします。</p>`);
      if (idx === -1) {
        if (st.spot.heroIP) { // チェックバック
          st.log.push({ text: `${STREETS[st.street]}: チェックで回る` });
          coach(verdictHTML(cls) + msg + '<br>お互いチェックで、次のカードへ進みます。');
          renderTable(); return nextStreet('');
        }
        coach(verdictHTML(cls) + msg);
        renderTable();
        return setNext('相手のアクションへ', () => villainAct(st.street, board, 'あなたはチェックしました。'));
      }
      const B = mine.B;
      if (mine.calls.some(c => key(c) === key(st.vill))) {
        st.pot += 2 * B; st.stack -= B; st.range = mine.calls;
        st.vAct = 'コール';
        st.log.push({ text: `${STREETS[st.street]}: 相手はコール` });
        coach(verdictHTML(cls) + msg + `<br>相手は<b>コール</b>しました。ポットは ${bb(st.pot)} になりました。`);
        renderTable(); return nextStreet('');
      }
      // 相手フォールド → ハンド終了
      st.vAct = 'フォールド';
      st.log.push({ text: `${STREETS[st.street]}: 相手はフォールド`, res: `ポット ${bb(st.pot)} を獲得`, cls: 'good' });
      st.showdown = true;
      coach(verdictHTML(cls) + msg + `<br><b>相手は降りました！</b> ポット ${bb(st.pot)} はあなたのものです。` +
        `（参考: 相手の手札は ${st.vill.map(cardText).join(' ')}）<br>このハンドの判断ミスによる損: <b>${st.loss >= 0.005 ? st.loss.toFixed(2) + 'bb' : 'なし'}</b>`);
      renderTable();
      setNext('次のハンド', newHand);
    });
  }

  function calcLater(fn, done) {
    coach('<span class="muted">考え中…</span>');
    setTimeout(() => done(fn()), 20);
  }

  function decide(choice) {
    const p = st.pending; if (!p || p.done) return;
    p.done = true;
    lockButtons(choice === 'call' ? 0 : 1);
    calcLater(() => E.equity(st.hero, p.betRange, p.board, 15000), r => {
      const need = p.bet / (st.pot + 2 * p.bet);
      const evCall = r.equity * (st.pot + 2 * p.bet) - p.bet; // フォールド(0)との差
      const best = evCall >= 0 ? 'call' : 'fold';
      const loss = choice === best ? 0 : Math.abs(evCall);
      const cls = loss === 0 ? 'good' : loss < 0.25 ? 'ok' : 'bad';
      stats.decisions++; if (cls !== 'bad') stats.good++; stats.evLoss += loss; st.loss += loss;
      store.set('handStats', stats); renderStats();
      st.log.push({ text: `${STREETS[st.street]}: 相手 ${bb(p.bet)} ベット → ${choice === 'call' ? 'コール' : 'フォールド'}（必要 ${pct(need)} / あなた ${pct(r.equity)}）`, res: VERDICT[cls], cls });
      const pot = st.pot;
      st.heroTurn = false; st.hAct = choice === 'call' ? 'コール' : 'フォールド';
      coach(verdictHTML(cls) +
        `コールで得をするには、勝率が <b>${pct0(need)}</b> 以上必要です（払う ${bb(p.bet)} ÷ 勝ったときにもらえるポット ${bb(pot + 2 * p.bet)}）。<br>` +
        `相手がこのベットをしてくる手を考えると、あなたの勝率は <b>${pct0(r.equity)}</b>。` +
        (evCall >= 0 ? `足りているので <b>コール</b> が得です（コールの期待値 ${evText(evCall)}）。` : `足りないので <b>フォールド</b> が得です（コールすると平均 ${evText(evCall)}）。`) +
        (choice === 'fold' ? '<br>練習のため、ここからはコールしたものとして続けます。' : ''));
      details(`<div class="eq-compare">
          <div><span class="muted small">必要な勝率</span><b>${pct(need)}</b><span class="muted small">${bb(p.bet)} ÷ (${bb(pot)} + ${bb(p.bet)}×2)</span></div>
          <div><span class="muted small">あなたの勝率</span><b class="${evCall >= 0 ? 'pos' : 'neg'}">${pct(r.equity)}</b><span class="muted small">相手のベットレンジ ${p.betRange.length} コンボに対して</span></div>
        </div>
        <div class="freq-row"><span>コールの期待値</span><b>${evText(evCall)}</b></div>
        <div class="freq-row"><span>フォールドの期待値</span><b>${evText(0)}</b></div>`);
      // 練習のため、フォールドしてもコールしたものとして続行
      st.pot += 2 * p.bet; st.stack -= p.bet; st.range = p.betRange; st.pending = null; st.bets = { hero: 0, vill: 0 };
      renderTable();
      nextStreet(choice === 'fold' ? '（コールしたものとして）' : '');
    });
  }

  function showdown() {
    st.showdown = true; st.street = 3; st.heroTurn = false; st.bets = { hero: 0, vill: 0 };
    const h = E.eval7([...st.hero, ...st.board]), v = E.eval7([...st.vill, ...st.board]);
    const res = h > v ? ['あなたの勝ち', 'good'] : h < v ? ['相手の勝ち', 'bad'] : ['引き分け', 'ok'];
    st.hAct = E.category(h); st.vAct = E.category(v);
    st.log.push({ text: `ショーダウン: あなた ${E.category(h)} / 相手 ${E.category(v)}`, res: res[0], cls: res[1] });
    $('hpActions').innerHTML = '';
    coach(`<div class="verdict ${res[1]}">${res[0]}</div>ショーダウン！ 相手の手札は ${st.vill.map(cardText).join(' ')} で <b>${E.category(v)}</b>、` +
      `あなたは <b>${E.category(h)}</b>。ポット ${bb(st.pot)} は${h > v ? 'あなた' : h < v ? '相手' : '半分ずつ'}のものです。<br>` +
      `このハンドの判断ミスによる損: <b>${st.loss >= 0.005 ? st.loss.toFixed(2) + 'bb' : 'なし'}</b>。` +
      '勝ち負けは運も混じるので、判断の良し悪しは期待値（EV）で見ましょう。');
    details('');
    renderTable();
    setNext('次のハンド', newHand);
  }

  // ---------- 初期化 ----------
  $('hpCoachFace').innerHTML = TableUI.COACH_SVG;
  for (const s of SPOTS) $('hpSpot').append(new Option(s.name, s.id));
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
