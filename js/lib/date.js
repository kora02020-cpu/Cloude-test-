// 日付はすべて端末のローカル時刻(JST想定)で扱い、文字列は 'YYYY-MM-DD'。
// 'YYYY-MM-DD' 同士は文字列比較で前後関係が正しく判定できる。
import { PAYDAY } from '../config.js';

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function diffDays(a, b) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ua - ub) / 86400000);
}

export function monthKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// 暦月(1日〜末日)
export function monthRange(d) {
  return {
    key: monthKey(d),
    start: ymd(new Date(d.getFullYear(), d.getMonth(), 1)),
    end: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

// d を含む週の月〜金
export function weekDays(d) {
  const mon = addDays(d, -((d.getDay() + 6) % 7));
  return [0, 1, 2, 3, 4].map((i) => ymd(addDays(mon, i)));
}

// 支出の集計期間。26日以降なら今月26日開始、25日以前なら前月26日開始
export function cycleOf(d) {
  const startMonth = d.getDate() > PAYDAY ? d.getMonth() : d.getMonth() - 1;
  const start = new Date(d.getFullYear(), startMonth, PAYDAY + 1);
  const end = new Date(d.getFullYear(), startMonth + 1, PAYDAY);
  return { key: ymd(start), start: ymd(start), end: ymd(end) };
}

export function shiftCycle(cycle, n) {
  const s = parseYmd(cycle.start);
  return cycleOf(new Date(s.getFullYear(), s.getMonth() + n, PAYDAY + 1));
}

export function daysUntilPayday(d) {
  const target = d.getDate() > PAYDAY
    ? new Date(d.getFullYear(), d.getMonth() + 1, PAYDAY)
    : new Date(d.getFullYear(), d.getMonth(), PAYDAY);
  return diffDays(target, d);
}

export const inRange = (s, range) => s >= range.start && s <= range.end;

export function weekdayJa(s) {
  return WEEKDAYS_JA[parseYmd(s).getDay()];
}

// '2026-10-26' → '10/26'
export function fmtMD(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// '2026-10-26' → '10.26'
export function fmtDot(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

export function englishDate(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}
