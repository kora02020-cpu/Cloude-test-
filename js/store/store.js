// アプリの状態。画面はここだけを読み書きし、同期層は pending / markPushed / applyRemote を使う。
//
// レコードは種類(kind)を問わず同じ形で持つ:
//   { kind, id, data, updatedAt(ISO), deleted }
// kind: 'visit'(id=日付) / 'order' / 'expense' / 'goal'(id='YYYY-MM')
// 新しい種類(例:カレンダーの予定)はこのファイルを変えずに追加できる。
import { local } from './local.js';

const keyOf = (kind, id) => `${kind}:${id}`;
const view = (r) => ({ id: r.id, ...r.data });

export function createStore() {
  let records = local.loadRecords();
  let outbox = local.loadOutbox();
  let meta = local.loadMeta();
  let status = { state: 'local', pending: 0, message: '' };
  const listeners = new Set();
  const statusListeners = new Set();

  const store = {
    // 同期層が差し込むフック。ローカルで書き込むたびに呼ばれる
    onLocalWrite: () => {},

    list(kind) {
      return Object.values(records).filter((r) => r.kind === kind && !r.deleted).map(view);
    },

    get(kind, id) {
      const r = records[keyOf(kind, id)];
      return r && !r.deleted ? view(r) : null;
    },

    put(kind, id, data) {
      write(kind, String(id), data, false);
    },

    remove(kind, id) {
      const r = records[keyOf(kind, id)];
      if (r && !r.deleted) write(kind, String(id), r.data, true);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // --- 同期層向け ---
    pending() {
      return Object.keys(outbox).map((k) => records[k]).filter(Boolean);
    },

    pendingCount() {
      return Object.keys(outbox).length;
    },

    // 送信できたものをキューから外す。送信中に書き換わったものは残す
    markPushed(sent) {
      for (const r of sent) {
        const k = keyOf(r.kind, r.id);
        if (outbox[k] === r.updatedAt) delete outbox[k];
      }
      local.saveOutbox(outbox);
    },

    // サーバーから来たレコードを後勝ち(updatedAt が新しい方)で取り込む
    applyRemote(list) {
      let changed = false;
      for (const r of list) {
        const k = keyOf(r.kind, r.id);
        const cur = records[k];
        if (cur && cur.updatedAt >= r.updatedAt) continue;
        records[k] = r;
        if (outbox[k] && outbox[k] <= r.updatedAt) delete outbox[k];
        changed = true;
      }
      if (changed) {
        local.saveRecords(records);
        local.saveOutbox(outbox);
        emit();
      }
    },

    // 初回ログイン時など、手元の全件を送り直す
    enqueueAll() {
      for (const [k, r] of Object.entries(records)) outbox[k] = r.updatedAt;
      local.saveOutbox(outbox);
    },

    meta: () => meta,
    setMeta(patch) {
      meta = { ...meta, ...patch };
      local.saveMeta(meta);
    },

    status: () => status,
    setStatus(next) {
      status = { ...status, ...next };
      for (const fn of statusListeners) fn(status);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
  };

  function write(kind, id, data, deleted) {
    const k = keyOf(kind, id);
    const prev = records[k];
    // 同じミリ秒に2回書いても順序が崩れないよう、前回より必ず後の時刻にする
    const t = Math.max(Date.now(), prev ? Date.parse(prev.updatedAt) + 1 : 0);
    const updatedAt = new Date(t).toISOString();
    records[k] = { kind, id, data, updatedAt, deleted };
    outbox[k] = updatedAt;
    local.saveRecords(records);
    local.saveOutbox(outbox);
    emit();
    store.onLocalWrite();
  }

  function emit() {
    for (const fn of listeners) fn();
  }

  return store;
}
