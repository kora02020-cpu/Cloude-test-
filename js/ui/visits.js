// 訪問カード:今日の件数タイルと、今週(月〜金)の棒グラフ
import { QUOTA, COLORS } from '../config.js';
import { ymd, weekDays, weekdayJa, fmtMD } from '../lib/date.js';
import { num, ratio } from '../lib/logic.js';
import { renderBarChart, tableHTML } from '../lib/charts.js';
import { $ } from './dom.js';

const TILES = [
  { key: 'effective', label: '有効訪問', short: '有効', color: COLORS.blue },
  { key: 'cold', label: '飛び込み', short: '飛込', color: COLORS.green },
];

let selectedDay = null;
let showTable = false;

function visitOf(store, date) {
  const v = store.get('visit', date);
  return { effective: num(v?.effective), cold: num(v?.cold) };
}

export function mount(ctx) {
  $('#visit-tiles').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const today = ymd(ctx.now());
    const cur = visitOf(ctx.store, today);
    const key = b.dataset.key;
    const next = Math.max(0, cur[key] + (b.dataset.act === 'inc' ? 1 : -1));
    if (next === cur[key]) return;
    ctx.store.put('visit', today, { date: today, ...cur, [key]: next });
  });

  $('#week-toggle').addEventListener('click', (e) => {
    showTable = !showTable;
    e.currentTarget.setAttribute('aria-pressed', String(showTable));
    e.currentTarget.textContent = showTable ? 'グラフ' : '表';
    render(ctx);
  });
}

export function render(ctx) {
  const today = ymd(ctx.now());
  const cur = visitOf(ctx.store, today);

  $('#visit-tiles').innerHTML = TILES.map((t) => {
    const n = cur[t.key];
    const q = QUOTA[t.key];
    const done = n >= q;
    const w = Math.min(100, ratio(n, q) * 100);
    return `<div class="tile${done ? ' done' : ''}">
      <div class="tile-head">
        <span class="tile-label">${t.label}</span>
        ${done ? '<span class="badge">✓ 達成</span>' : `<span class="tile-remain">あと ${q - n} 件</span>`}
      </div>
      <p class="big"><span class="num">${n}</span><span class="of"> / ${q}</span></p>
      <div class="bar" role="progressbar" aria-label="${t.label}の進捗" aria-valuemin="0" aria-valuemax="${q}" aria-valuenow="${Math.min(n, q)}">
        <span style="width:${w}%;background:${done ? COLORS.green : t.color}"></span>
      </div>
      <div class="tile-actions">
        <button class="btn ghost" type="button" data-act="dec" data-key="${t.key}" ${n === 0 ? 'disabled' : ''} aria-label="${t.label}を1件取り消す">取消</button>
        <button class="btn primary" type="button" data-act="inc" data-key="${t.key}" aria-label="${t.label}を1件追加">+1</button>
      </div>
    </div>`;
  }).join('');

  const days = weekDays(ctx.now());
  const rows = days.map((d) => ({ d, ...visitOf(ctx.store, d) }));
  const totalE = rows.reduce((a, r) => a + r.effective, 0);
  const totalC = rows.reduce((a, r) => a + r.cold, 0);
  const detail = (r) => `${fmtMD(r.d)}(${weekdayJa(r.d)}) 有効 ${r.effective}件・飛込 ${r.cold}件`;

  $('#week-legend').innerHTML = TILES.map((t) => `<span class="key"><i style="background:${t.color}"></i>${t.short} 計${t.key === 'effective' ? totalE : totalC}</span>`).join('');

  const chartEl = $('#week-chart');
  const tableEl = $('#week-table');
  chartEl.hidden = showTable;
  tableEl.hidden = !showTable;
  if (showTable) {
    tableEl.innerHTML = tableHTML('今週の訪問件数',
      [{ label: '日付' }, { label: '有効', align: 'right' }, { label: '飛込', align: 'right' }],
      [...rows.map((r) => [`${fmtMD(r.d)}(${weekdayJa(r.d)})${r.d === today ? ' 今日' : ''}`, r.effective, r.cold]),
        ['合計', totalE, totalC]]);
  } else {
    renderBarChart(chartEl, {
      mode: 'grouped',
      height: 150,
      refLine: Math.max(QUOTA.effective, QUOTA.cold),
      showValues: true,
      selectedKey: selectedDay,
      ariaLabel: '今週の訪問件数の棒グラフ',
      groups: rows.map((r) => ({
        key: r.d,
        label: weekdayJa(r.d),
        emphasis: r.d === today,
        detail: detail(r),
        bars: [
          { value: r.effective, color: COLORS.blue, name: '有効' },
          { value: r.cold, color: COLORS.green, name: '飛込' },
        ],
      })),
      onSelect: (key) => {
        selectedDay = selectedDay === key ? null : key;
        render(ctx);
      },
    });
  }

  const sel = rows.find((r) => r.d === selectedDay);
  $('#week-caption').textContent = showTable ? ''
    : sel ? detail(sel) : '棒をタップすると件数を表示します(点線はノルマ)';
}
