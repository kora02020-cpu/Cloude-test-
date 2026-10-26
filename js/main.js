// 起動処理:状態・同期・各カードをつなぐ
import { SYNC } from './config.js';
import { ymd } from './lib/date.js';
import { createStore } from './store/store.js';
import { startSync } from './sync/engine.js';
import { createNoneAdapter } from './sync/none.js';
import { createSupabaseAdapter } from './sync/supabase.js';
import { createClaudeDbAdapter } from './sync/claude-db.js';
import * as header from './ui/header.js';
import * as visits from './ui/visits.js';
import * as orders from './ui/orders.js';
import * as money from './ui/money.js';
import * as syncUi from './ui/sync.js';

const store = createStore();

// 同期先:Supabase の設定があればそれ、claude.ai のページとして開いていれば
// そのページの保存領域、どちらでもなければ端末内のみ
function pickAdapter() {
  if (SYNC.supabaseUrl && SYNC.supabaseKey) {
    return createSupabaseAdapter({ url: SYNC.supabaseUrl, key: SYNC.supabaseKey });
  }
  if (typeof window.claude?.use === 'function') return createClaudeDbAdapter();
  return createNoneAdapter();
}
const adapter = pickAdapter();

const ctx = { store, now: () => new Date(), sync: null };
const views = [header, visits, orders, money];

for (const v of views) v.mount?.(ctx);
const renderAll = () => { for (const v of views) v.render(ctx); };
store.subscribe(renderAll);
renderAll();

syncUi.mount(ctx);
ctx.sync = startSync(store, adapter);

// 日付が変わったら(開きっぱなし・復帰時)表示と入力欄の日付を今日にする
let day = ymd(ctx.now());
function checkDay() {
  const d = ymd(ctx.now());
  if (d === day) return;
  day = d;
  orders.resetDates(ctx);
  money.resetDates(ctx);
  renderAll();
}
setInterval(checkDay, 30 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkDay();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
