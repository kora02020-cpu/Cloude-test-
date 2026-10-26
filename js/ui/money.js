// お金カード:今期(26日〜翌25日)の支出合計・カテゴリ別・追加・直近一覧・期ごとの推移
import { CATEGORIES, COLORS, TREND_CYCLES } from '../config.js';
import { ymd, cycleOf, shiftCycle, inRange, fmtMD, fmtDot } from '../lib/date.js';
import { byCategory, sum, pct, yen, newId, esc } from '../lib/logic.js';
import { renderBarChart, stackBar, tableHTML } from '../lib/charts.js';
import { local } from '../store/local.js';
import { $, createConfirmDelete, deleteButton, setMsg, parseNumber } from './dom.js';

const RECENT_COUNT = 8;
const catColor = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.color]));

let confirmDel;
let selectedCycle = null;
let showTable = false;

const cycleLabel = (c) => `${fmtDot(c.start)} – ${fmtDot(c.end)}`;

function breakdownHTML(rows, total) {
  return `${stackBar(rows, total)}
    <ul class="cat-list">${rows.map((r) => `<li>
      <span class="cat-name"><i style="background:${r.color}"></i>${r.id}</span>
      <span class="cat-amount">${yen(r.amount)}</span>
      <span class="cat-share">${pct(r.share)}</span>
    </li>`).join('')}</ul>`;
}

export function mount(ctx) {
  confirmDel = createConfirmDelete((id) => ctx.store.remove('expense', id), () => render(ctx));

  const prefs = local.loadPrefs();
  const lastCat = CATEGORIES.some((c) => c.id === prefs.lastCat) ? prefs.lastCat : '食費';
  $('#cat-options').innerHTML = CATEGORIES.map((c) => `<label class="cat-opt">
      <input type="radio" name="cat" value="${c.id}" ${c.id === lastCat ? 'checked' : ''}>
      <span><i style="background:${c.color}"></i>${c.id}</span>
    </label>`).join('');

  const form = $('#expense-form');
  form.date.value = ymd(ctx.now());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseNumber(form.amount.value);
    const date = form.date.value;
    const cat = form.cat.value;
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) return setMsg(form, '金額は1円以上の整数で入れてください');
    if (!date) return setMsg(form, '日付を入れてください');
    if (!cat) return setMsg(form, 'カテゴリを選んでください');
    ctx.store.put('expense', newId(), { date, amount, cat, note: form.note.value.trim() });
    local.savePrefs({ ...local.loadPrefs(), lastCat: cat });
    const cycle = cycleOf(ctx.now());
    setMsg(form, inRange(date, cycle) ? `${cat} ${yen(amount)} を追加しました`
      : `${cat} ${yen(amount)} を追加しました(今期の外の日付です)`, true);
    form.amount.value = '';
    form.note.value = '';
  });

  $('#expense-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (b) confirmDel.tap(b.dataset.del);
  });

  $('#trend-toggle').addEventListener('click', (e) => {
    showTable = !showTable;
    e.currentTarget.setAttribute('aria-pressed', String(showTable));
    e.currentTarget.textContent = showTable ? 'グラフ' : '表';
    render(ctx);
  });
}

export function render(ctx) {
  const expenses = ctx.store.list('expense');
  const cycle = cycleOf(ctx.now());
  const inCycle = expenses.filter((e) => inRange(e.date, cycle));
  const total = sum(inCycle, (e) => e.amount);
  const rows = byCategory(inCycle);

  $('#money-title').textContent = `支出 ${cycleLabel(cycle)}`;
  $('#money-summary').innerHTML = `
    <div class="kpi">
      <p class="big"><span class="num">${yen(total)}</span></p>
      <p class="kpi-side">今期 ${inCycle.length} 件</p>
    </div>
    ${breakdownHTML(rows, total)}`;

  const recent = [...expenses]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, RECENT_COUNT);
  $('#expense-list').innerHTML = recent.length
    ? recent.map((e) => `<li class="item">
        <span class="item-date">${fmtMD(e.date)}</span>
        <span class="item-main"><span class="chip"><i style="background:${catColor[e.cat] || COLORS.muted}"></i>${esc(e.cat)}</span>${e.note ? ` <span class="item-note">${esc(e.note)}</span>` : ''}</span>
        <span class="item-amount">${yen(e.amount)}</span>
        ${deleteButton(esc(e.id), confirmDel.isArmed(e.id), '支出')}
      </li>`).join('')
    : '<li class="empty">まだ支出の記録がありません</li>';

  // 推移:古い期 → 今期
  const cycles = Array.from({ length: TREND_CYCLES }, (_, i) => shiftCycle(cycle, i - TREND_CYCLES + 1));
  const series = cycles.map((c) => {
    const list = expenses.filter((e) => inRange(e.date, c));
    return { c, total: sum(list, (e) => e.amount), rows: byCategory(list) };
  });
  if (selectedCycle && !series.some((s) => s.c.key === selectedCycle)) selectedCycle = null;

  const chartEl = $('#trend-chart');
  const tableEl = $('#trend-table');
  chartEl.hidden = showTable;
  tableEl.hidden = !showTable;
  if (showTable) {
    tableEl.innerHTML = tableHTML('期ごとの支出',
      [{ label: '期' }, ...CATEGORIES.map((c) => ({ label: c.id, align: 'right' })), { label: '合計', align: 'right' }],
      series.map((s) => [cycleLabel(s.c), ...s.rows.map((r) => yen(r.amount)), yen(s.total)]));
  } else {
    renderBarChart(chartEl, {
      mode: 'stacked',
      height: 160,
      showValues: true,
      formatTotal: (v) => (v >= 10000 ? `${Math.round(v / 1000) / 10}万` : Math.round(v).toLocaleString('ja-JP')),
      selectedKey: selectedCycle,
      ariaLabel: '期ごとの支出合計の棒グラフ',
      groups: series.map((s) => ({
        key: s.c.key,
        label: fmtMD(s.c.start),
        emphasis: s.c.key === cycle.key,
        detail: `${cycleLabel(s.c)} 合計 ${yen(s.total)}`,
        bars: s.c.key === selectedCycle
          ? s.rows.map((r) => ({ value: r.amount, color: r.color, name: r.id }))
          : [{ value: s.total, color: s.c.key === cycle.key ? COLORS.blue : COLORS.idle, name: '合計' }],
      })),
      onSelect: (key) => {
        selectedCycle = selectedCycle === key ? null : key;
        render(ctx);
      },
    });
  }

  const sel = series.find((s) => s.c.key === selectedCycle);
  $('#trend-caption').textContent = showTable ? ''
    : sel ? `${cycleLabel(sel.c)} 合計 ${yen(sel.total)}` : '棒をタップすると、その期のカテゴリ内訳を表示します';
  $('#trend-breakdown').innerHTML = !showTable && sel ? breakdownHTML(sel.rows, sel.total) : '';
}

export function resetDates(ctx) {
  $('#expense-form').date.value = ymd(ctx.now());
}
