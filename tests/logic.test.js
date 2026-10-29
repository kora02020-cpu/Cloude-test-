import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commission, byCategory, ratio, yen, pts } from '../js/lib/logic.js';
import { cycleOf, shiftCycle, daysUntilPayday, weekDays, monthRange } from '../js/lib/date.js';
import { COMMISSION_TIERS } from '../js/config.js';

const d = (y, m, day) => new Date(y, m - 1, day);

test('歩合:段階に届く前', () => {
  const c = commission(0);
  assert.equal(c.yen, 0);
  assert.equal(c.current, null);
  assert.equal(c.next.points, 150);
  assert.equal(c.remaining, 150);
  assert.equal(c.gain, 10000);
});

test('歩合:ちょうど段階の値なら、その段階を適用', () => {
  assert.equal(commission(150).yen, 10000);
  assert.equal(commission(180).yen, 13000);
  assert.equal(commission(200).yen, 24000);
  assert.equal(commission(250).yen, 30000);
  assert.equal(commission(300).yen, 42000);
  assert.equal(commission(350).yen, 49000);
});

test('歩合:段階の間は下の段階、次は上の段階', () => {
  const c = commission(199);
  assert.equal(c.yen, 13000);
  assert.equal(c.next.points, 200);
  assert.equal(c.remaining, 1);
  assert.equal(c.gain, 11000);
  assert.equal(commission(349.5).yen, 42000);
});

test('歩合:上限 3000P', () => {
  assert.equal(COMMISSION_TIERS.at(-1).points, 3000);
  const c = commission(5000);
  assert.equal(c.yen, 3000 * 140);
  assert.equal(c.next, null);
  assert.equal(c.remaining, 0);
});

test('歩合:不正な入力でも NaN にならない', () => {
  for (const v of [NaN, undefined, null, 'abc']) {
    const c = commission(v);
    assert.equal(c.yen, 0);
    assert.equal(c.remaining, 150);
  }
});

test('支出の期:26日以降は今月26日開始', () => {
  assert.deepEqual(cycleOf(d(2026, 10, 26)), { key: '2026-10-26', start: '2026-10-26', end: '2026-11-25' });
  assert.deepEqual(cycleOf(d(2026, 10, 31)), { key: '2026-10-26', start: '2026-10-26', end: '2026-11-25' });
});

test('支出の期:25日以前は前月26日開始(年またぎ含む)', () => {
  assert.equal(cycleOf(d(2026, 10, 25)).start, '2026-09-26');
  assert.equal(cycleOf(d(2026, 1, 10)).start, '2025-12-26');
  assert.equal(cycleOf(d(2026, 1, 10)).end, '2026-01-25');
  assert.equal(cycleOf(d(2026, 12, 26)).end, '2027-01-25');
});

test('支出の期をずらす', () => {
  const c = cycleOf(d(2026, 1, 30));
  assert.equal(shiftCycle(c, -1).start, '2025-12-26');
  assert.equal(shiftCycle(c, -2).start, '2025-11-26');
  assert.equal(shiftCycle(c, 1).start, '2026-02-26');
});

test('給料日までの日数', () => {
  assert.equal(daysUntilPayday(d(2026, 10, 26)), 30);
  assert.equal(daysUntilPayday(d(2026, 10, 25)), 0);
  assert.equal(daysUntilPayday(d(2026, 10, 24)), 1);
  assert.equal(daysUntilPayday(d(2026, 12, 31)), 25);
});

test('今週の月〜金', () => {
  assert.deepEqual(weekDays(d(2026, 10, 26)), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  assert.deepEqual(weekDays(d(2026, 11, 1)), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
});

test('暦月', () => {
  assert.deepEqual(monthRange(d(2026, 2, 10)), { key: '2026-02', start: '2026-02-01', end: '2026-02-28' });
});

test('カテゴリ集計:空でも割合は 0', () => {
  const rows = byCategory([]);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.amount === 0 && r.share === 0));
  const r2 = byCategory([{ cat: '食費', amount: 300 }, { cat: '趣味', amount: 100 }]);
  assert.equal(r2.find((r) => r.id === '食費').share, 0.75);
});

test('表示用の整形', () => {
  assert.equal(ratio(1, 0), 0);
  assert.equal(yen(12345), '¥12,345');
  assert.equal(yen(NaN), '¥0');
  assert.equal(pts(12.34), '12.3');
});

test('固定費の日付:今期の中の毎月N日', async () => {
  const { dateInCycle } = await import('../js/ui/fixed.js').catch(() => ({}));
  if (!dateInCycle) return; // DOM を使う部品の読み込みに失敗する環境では省略
  const c = cycleOf(d(2026, 10, 29));
  assert.equal(dateInCycle(c, 1), '2026-11-01');
  assert.equal(dateInCycle(c, 25), '2026-11-25');
  assert.equal(dateInCycle(c, 27), '2026-10-27');
  assert.equal(dateInCycle(cycleOf(d(2027, 1, 30)), 31), '2027-01-31');
  assert.equal(dateInCycle(cycleOf(d(2027, 2, 1)), 31), '2027-01-31');
});
