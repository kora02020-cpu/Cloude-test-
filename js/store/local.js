// localStorage への読み書き。プライベートブラウズ等で使えない場合も例外を外に出さない。
const PREFIX = 'board.v1.';

function read(name, fallback) {
  try {
    const s = localStorage.getItem(PREFIX + name);
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

function write(name, value) {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const local = {
  // { 'kind:id': { kind, id, data, updatedAt, deleted } }
  loadRecords: () => read('records', {}),
  saveRecords: (records) => write('records', records),
  // 未送信キュー { 'kind:id': updatedAt }
  loadOutbox: () => read('outbox', {}),
  saveOutbox: (outbox) => write('outbox', outbox),
  // 同期の進み具合など { since }
  loadMeta: () => read('meta', {}),
  saveMeta: (meta) => write('meta', meta),
  // 画面の小さな好み(最後に選んだカテゴリなど)
  loadPrefs: () => read('prefs', {}),
  savePrefs: (prefs) => write('prefs', prefs),
};
