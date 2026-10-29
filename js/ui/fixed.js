// 毎月の固定費:登録した一覧(kind 'fixed')から、今期の支出を自動で作る
import { PAYDAY } from '../config.js';
import { cycleOf, parseYmd, ymd } from '../lib/date.js';
import { yen, sum, esc, newId, num } from '../lib/logic.js';
import { $, createConfirmDelete, deleteButton, setMsg, parseNumber } from './dom.js';

let confirmDel;

// 今期の中で、毎月 day 日にあたる日付。26日以降なら期の始まりの月、それ以外は翌月
export function dateInCycle(cycle, day) {
  const s = parseYmd(cycle.start);
  const m = day > PAYDAY ? s.getMonth() : s.getMonth() + 1;
  const last = new Date(s.getFullYear(), m + 1, 0).getDate();
  return ymd(new Date(s.getFullYear(), m, Math.min(day, last)));
}

// 今期の分がまだ無ければ作る。作ったら true
export function generate(ctx) {
  const cycle = cycleOf(ctx.now());
  // 自動で作る記録は古い時刻にしておき、手で削除・変更したものを優先させる
  const updatedAt = parseYmd(cycle.start).toISOString();
  const list = ctx.store.list('fixed')
    .filter((t) => num(t.amount) > 0)
    .map((t) => {
      const date = dateInCycle(cycle, num(t.day) || 1);
      return {
        kind: 'expense',
        id: `fixed-${t.id}-${date.slice(0, 7)}`,
        data: { date, amount: num(t.amount), cat: '固定費', note: t.name || '' },
        updatedAt,
      };
    });
  return ctx.store.seedMany(list);
}

export function mount(ctx) {
  confirmDel = createConfirmDelete((id) => ctx.store.remove('fixed', id), () => render(ctx));

  const form = $('#fixed-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const amount = parseNumber(form.amount.value);
    const day = parseNumber(form.day.value);
    if (!name) return setMsg(form, '名前を入れてください');
    if (!Number.isInteger(amount) || amount <= 0) return setMsg(form, '金額は1円以上の整数で入れてください');
    if (!Number.isInteger(day) || day < 1 || day > 31) return setMsg(form, '支払日は1〜31で入れてください');
    ctx.store.put('fixed', newId(), { name, amount, day });
    setMsg(form, `${name} ${yen(amount)}(毎月${day}日)を登録しました。今期の支出にも追加しました`, true);
    form.name.value = '';
    form.amount.value = '';
  });

  $('#fixed-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (b) confirmDel.tap(b.dataset.del);
  });
}

export function render(ctx) {
  const list = ctx.store.list('fixed').sort((a, b) => num(a.day) - num(b.day) || num(b.amount) - num(a.amount));
  $('#fixed-total').textContent = list.length ? `毎月 ${yen(sum(list, (t) => t.amount))}` : '';
  $('#fixed-list').innerHTML = list.length
    ? list.map((t) => `<li class="item">
        <span class="item-date">${num(t.day) || 1}日</span>
        <span class="item-main">${esc(t.name)}</span>
        <span class="item-amount">${yen(t.amount)}</span>
        ${deleteButton(esc(t.id), confirmDel.isArmed(t.id), '固定費')}
      </li>`).join('')
    : '<li class="empty">まだ登録がありません</li>';
}
