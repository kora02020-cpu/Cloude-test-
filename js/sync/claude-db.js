// claude.ai のページとして開いたときの同期。ページの db 機能を使い、
// 閲覧者本人だけが読み書きできる data/users/<id>/ に保存する。
//
// 1件1ドキュメントにするとドキュメント数が増え続けるため、
// 「種類 × 月」ごとに1ドキュメントへまとめる(例:expense~2026-10)。
//   { records: { <id>: { data, updatedAt, deleted } } }
// 追記は update の入れ子マージで行うので、別端末の追記を消さない。
const bucketOf = (r) => `${r.kind}~${String(r.data?.date || r.data?.month || r.id).slice(0, 7)}`;

export function createClaudeDbAdapter() {
  let state = 'connecting'; // connecting / ready / unavailable
  let col = null;
  let latest = [];
  let onRemote = () => {};
  let onReady = () => {};

  function flatten(docs) {
    const out = [];
    for (const d of docs) {
      const body = d.data();
      const kind = body?.kind;
      if (!kind || !body.records) continue;
      for (const [id, r] of Object.entries(body.records)) {
        if (!r?.updatedAt) continue;
        out.push({ kind, id, data: r.data || {}, updatedAt: r.updatedAt, deleted: !!r.deleted });
      }
    }
    return out;
  }

  (async () => {
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      const uid = db && user ? await user.id() : null;
      if (!uid) { state = 'unavailable'; onReady(); return; }
      col = db.collection(`data/users/${uid}`);
      col.onSnapshot((snap) => {
        latest = flatten(snap.docs);
        onRemote(latest);
      }, () => { /* 購読が切れても、記録と送信は続けられる */ });
      state = 'ready';
    } catch {
      state = 'unavailable';
    }
    onReady();
  })();

  async function writeBucket(key, recs) {
    const records = {};
    for (const r of recs) records[r.id] = { data: r.data, updatedAt: r.updatedAt, deleted: !!r.deleted };
    const ref = col.doc(key);
    try {
      await ref.update({ records });
    } catch (e) {
      // まだ無いドキュメントは作る
      if (e?.code !== 'invalid_argument') throw e;
      await ref.set({ kind: recs[0].kind, records });
    }
  }

  return {
    kind: 'claude',
    enabled: true,
    state: () => state,
    signedIn: () => state === 'ready',
    email: () => '',
    set onRemote(fn) { onRemote = fn; },
    set onReady(fn) { onReady = fn; },

    async push(records) {
      const groups = new Map();
      for (const r of records) {
        const k = bucketOf(r);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      for (const [k, recs] of groups) {
        try {
          await writeBucket(k, recs);
        } catch (e) {
          throw new Error(e?.code === 'quota_exceeded' ? '保存容量の上限に達しました' : (e?.message || '保存できませんでした'));
        }
      }
    },

    async pull() {
      return { records: latest, cursor: null };
    },
  };
}
