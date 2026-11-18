// ポーカーテーブルの描画（人・座席・チップ・ディーラーボタン）。トレーナーとハンド練習で共通に使う
(function (root) {
  const ORDER = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];   // プリフロップの行動順
  const SKIN = ['#f2c9a0', '#d9a273', '#8d5a3b', '#f5d6b8', '#c68b59', '#e8b48a'];
  const SHIRT = { UTG: '#7c66dc', HJ: '#e0803c', CO: '#3c9ee0', BTN: '#d6409f', SB: '#8a9a3c', BB: '#40b0a0' };

  function person(pos) {
    const i = Math.max(0, ORDER.indexOf(pos));
    return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="23" class="pk-av-bg"/>
      <circle cx="24" cy="19" r="8" fill="${SKIN[i % SKIN.length]}"/>
      <path d="M16 17c0-6 3.5-9 8-9s8 3 8 9c-2-2.5-5-3.5-8-3.5s-6 1-8 3.5z" fill="#3a2a20"/>
      <path d="M9 44c1.5-9 8-14 15-14s13.5 5 15 14" fill="${SHIRT[pos] || '#888'}"/></svg>`;
  }
  const COACH_SVG = `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#2b3a4a"/><circle cx="32" cy="27" r="11" fill="#f2c9a0"/>
    <path d="M20 24c0-8 5-13 12-13s12 5 12 13c-3-3-7-4-12-4s-9 1-12 4z" fill="#f5b942"/><rect x="18" y="22" width="28" height="4" rx="2" fill="#f5b942"/>
    <circle cx="28" cy="28" r="1.4" fill="#222"/><circle cx="36" cy="28" r="1.4" fill="#222"/><path d="M28 33q4 3 8 0" stroke="#222" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M12 60c2-11 10-17 20-17s18 6 20 17" fill="#30a46c"/></svg>`;

  // 自分を下中央に置き、時計回り（左回り）に並べる。[x%, y%, 基準]
  const SLOTS6 = [[50, 100, 'bottom'], [8, 64, 'center'], [11, 2, 'top'], [50, 0, 'top'], [89, 2, 'top'], [92, 64, 'center']];
  const SLOTS2 = [[50, 100, 'bottom'], [50, 0, 'top']];

  // seats: 自分から時計回りの順。各要素 { pos, state: 'hero'|'in'|'waiting'|'folded', bubble, bubbleCls, stack, bet, cards(HTML), name }
  // opts: { dealer: 'BTN' などディーラーボタンを置く席 }
  function render(el, seats, opts = {}) {
    const n = seats.length, slots = n === 2 ? SLOTS2 : SLOTS6;
    let html = '';
    seats.forEach((s, k) => {
      const [x, y, anchor] = slots[k];
      const vy = anchor === 'top' ? y + 14 : anchor === 'bottom' ? y - 16 : y; // 席の見た目の中心
      const bubble = s.bubble ? `<div class="pk-bubble ${s.bubbleCls || s.state}">${s.bubble}</div>` : '';
      const cards = s.cards || '';
      html += `<div class="pk-seat ${s.state} anchor-${anchor} ${k === 0 ? 'bottom' : ''}" style="left:${x}%;top:${y}%">
        ${k === 0 ? cards + bubble : bubble + cards}
        <div class="pk-person">${person(s.pos)}</div>
        <div class="pk-name">${s.name || s.pos}</div>
        <div class="pk-stack">${+(+s.stack).toFixed(1)}bb</div>
      </div>`;
      if (s.bet > 0) { // ベットのチップ（席と中央の間。自分のチップは手札の左）
        const cx = k === 0 ? 33 : x + (50 - x) * 0.42, cy = k === 0 ? 68 : vy + (48 - vy) * 0.42;
        html += `<div class="pk-chip" style="left:${cx}%;top:${cy}%"><i></i>${+s.bet.toFixed(1)}</div>`;
      }
      if (opts.dealer === s.pos) {
        const dx = k === 0 ? 67 : x + (50 - x) * 0.22 + 7, dy = k === 0 ? 68 : vy + (48 - vy) * 0.22;
        html += `<div class="pk-dealer" style="left:${dx}%;top:${dy}%" title="ディーラーボタン">D</div>`;
      }
    });
    el.innerHTML = html;
  }
  // 自分から時計回りの席の並び
  function seatsFrom(hero, list = ORDER) {
    const i = list.indexOf(hero);
    return list.map((_, k) => list[(i + k) % list.length]);
  }
  root.TableUI = { ORDER, person, render, seatsFrom, COACH_SVG };
})(window);
