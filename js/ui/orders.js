// 受注ポイントカード:今月の合計・達成率・歩合の目安・受注の追加と一覧・月目標
import { COMMISSION_TIERS, DEFAULT_MONTHLY_GOAL, COLORS } from '../config.js';
import { ymd, monthRange, inRange, fmtMD, parseYmd } from '../lib/date.js';
import { commission, sum, ratio, pct, pts, yen, newId, esc, num } from '../lib/logic.js';
import { $, createConfirmDelete, deleteButton, setMsg, parseNumber } from './dom.js';

let confirmDel;

// 今月の目標。未設定なら直近の過去の目標、それもなければ既定値
export function goalFor(store, month) {
  const own = store.get('goal', month);
  if (own) return { points: num(own.points), isSet: true };
  const past = store.list('goal').filter((g) => g.id < month).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  return { points: past ? num(past.points) : DEFAULT_MONTHLY_GOAL, isSet: false };
}

export function mount(ctx) {
  confirmDel = createConfirmDelete((id) => ctx.store.remove('order', id), () => render(ctx));

  const form = $('#order-form');
  form.date.value = ymd(ctx.now());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const points = parseNumber(form.points.value);
    const date = form.date.value;
    if (!date) return setMsg(form, '日付を入れてください');
    if (!Number.isFinite(points) || points <= 0) return setMsg(form, 'ポイントは0より大きい数で入れてください');
    ctx.store.put('order', newId(), { date, points, note: form.note.value.trim() });
    const month = monthRange(ctx.now());
    setMsg(form, inRange(date, month) ? `${pts(points)}pt を追加しました`
      : `${pts(points)}pt を追加しました(${parseYmd(date).getMonth() + 1}月分のため今月の合計には入りません)`, true);
    form.points.value = '';
    form.note.value = '';
  });

  $('#orders-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (b) confirmDel.tap(b.dataset.del);
  });

  const goalForm = $('#goal-form');
  goalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseNumber(goalForm.goal.value);
    if (!Number.isFinite(v) || v <= 0) return setMsg(goalForm, '目標は0より大きい数で入れてください');
    const month = monthRange(ctx.now()).key;
    ctx.store.put('goal', month, { month, points: v });
    setMsg(goalForm, `今月の目標を ${pts(v)}pt にしました`, true);
  });
}

export function render(ctx) {
  const month = monthRange(ctx.now());
  const orders = ctx.store.list('order').filter((o) => inRange(o.date, month));
  const total = sum(orders, (o) => o.points);
  const goal = goalFor(ctx.store, month.key);
  const rate = ratio(total, goal.points);
  const reached = goal.points > 0 && total >= goal.points;

  $('#orders-summary').innerHTML = `
    <div class="kpi">
      <p class="big"><span class="num">${pts(total)}</span><span class="of"> / ${pts(goal.points)} pt</span></p>
      <p class="kpi-side${reached ? ' good' : ''}">${reached ? '✓ 目標達成' : '達成率'} <strong>${pct(rate)}</strong></p>
    </div>
    <div class="bar" role="progressbar" aria-label="今月の受注ポイントの達成率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(rate * 100))}">
      <span style="width:${Math.min(100, rate * 100)}%;background:${reached ? COLORS.green : COLORS.blue}"></span>
    </div>
    <p class="note">${fmtMD(month.start)} 〜 ${fmtMD(month.end)} の合計${goal.isSet ? '' : '(目標は未設定のため仮の値)'}</p>`;

  const c = commission(total);
  $('#orders-commission').innerHTML = `
    <div class="stat">
      <span class="label">歩合の目安</span>
      <span class="value">${yen(c.yen)}</span>
      <span class="sub">${c.current ? `${pts(c.current.points)}P の段階` : 'まだ段階に届いていません'}</span>
    </div>
    <div class="stat">
      <span class="label">次の段階まで</span>
      ${c.next
    ? `<span class="value"><small>あと</small> ${pts(c.remaining)} <small>pt</small></span>
         <span class="sub">${pts(c.next.points)}P 到達で ${yen(c.next.yen)}</span>
         <span class="sub">差額 +${yen(c.gain)}</span>`
    : '<span class="value">最上位</span><span class="sub">これ以上の段階はありません</span>'}
    </div>`;

  $('#tier-table').innerHTML = `<table class="data-table">
    <caption class="sr-only">歩合表</caption>
    <thead><tr><th scope="col">完了ポイント</th><th scope="col" class="r">歩合</th></tr></thead>
    <tbody>${COMMISSION_TIERS.map((t) => {
    const isCur = c.current === t;
    return `<tr class="${isCur ? 'current' : ''}"><th scope="row">${pts(t.points)}P${isCur ? ' <span class="tag">現在</span>' : ''}</th><td class="r">${yen(t.yen)}</td></tr>`;
  }).join('')}</tbody></table>`;

  const sorted = [...orders].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  $('#orders-list').innerHTML = sorted.length
    ? sorted.map((o) => `<li class="item">
        <span class="item-date">${fmtMD(o.date)}</span>
        <span class="item-main">${o.note ? esc(o.note) : '<span class="muted">メモなし</span>'}</span>
        <span class="item-amount">${pts(o.points)}pt</span>
        ${deleteButton(esc(o.id), confirmDel.isArmed(o.id), '受注')}
      </li>`).join('')
    : '<li class="empty">今月の受注はまだありません</li>';

  const goalForm = $('#goal-form');
  if (document.activeElement !== goalForm.goal) goalForm.goal.value = goal.isSet ? pts(goal.points).replace(/,/g, '') : '';
  goalForm.goal.placeholder = `未設定(${pts(goal.points)})`;
}

export function resetDates(ctx) {
  $('#order-form').date.value = ymd(ctx.now());
}
