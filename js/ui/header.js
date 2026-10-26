import { daysUntilPayday, englishDate } from '../lib/date.js';
import { $ } from './dom.js';

export function render(ctx) {
  const now = ctx.now();
  $('#today-en').textContent = englishDate(now);
  const n = daysUntilPayday(now);
  $('#payday').textContent = n === 0 ? '今日は給料日' : `給料日まで ${n} 日`;
}
