// Supabase との同期。SDK は使わず、REST API を fetch で呼ぶ。
// テーブル定義と設定手順は README の「同期の設定」を参照。
const SESSION_KEY = 'board.v1.session';
const PAGE = 1000;
// 書き込みの確定順と server_at の順が前後しても取りこぼさないよう、少し前から取り直す
const PULL_OVERLAP_MS = 60 * 1000;

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}

function saveSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* 保存できなくても動作は続ける */ }
}

function authError(message) {
  const e = new Error(message);
  e.auth = true;
  return e;
}

async function errorText(res) {
  try {
    const j = await res.json();
    return j.msg || j.message || j.error_description || j.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function createSupabaseAdapter({ url, key }) {
  const base = url.replace(/\/+$/, '');
  let session = loadSession();
  let refreshing = null;

  function setSession(j) {
    session = {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      userId: j.user?.id || session?.userId,
      email: j.user?.email || session?.email,
    };
    saveSession(session);
  }

  function clearSession() {
    session = null;
    saveSession(null);
  }

  async function token(grant, body) {
    return fetch(`${base}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // 同時に何度呼ばれても、更新は1回だけ行う
  function refresh() {
    if (!refreshing) {
      refreshing = (async () => {
        if (!session?.refreshToken) throw authError('ログインしてください');
        const res = await token('refresh_token', { refresh_token: session.refreshToken });
        if (res.status >= 400 && res.status < 500) {
          clearSession();
          throw authError('ログインの有効期限が切れました。もう一度ログインしてください');
        }
        if (!res.ok) throw new Error(await errorText(res));
        setSession(await res.json());
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function api(path, opts = {}, retried = false) {
    if (!session) throw authError('ログインしてください');
    if (Date.now() / 1000 > session.expiresAt - 60) await refresh();
    const res = await fetch(base + path, {
      ...opts,
      headers: {
        apikey: key,
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        ...opts.headers,
      },
    });
    if (res.status === 401 && !retried) {
      await refresh();
      return api(path, opts, true);
    }
    if (!res.ok) throw new Error(await errorText(res));
    return res;
  }

  return {
    enabled: true,
    signedIn: () => !!session,
    email: () => session?.email || '',

    async signIn(email, password) {
      if (!email || !password) throw new Error('メールアドレスとパスワードを入れてください');
      const res = await token('password', { email, password });
      if (!res.ok) {
        throw new Error(res.status === 400 ? 'メールアドレスかパスワードが違います' : await errorText(res));
      }
      setSession(await res.json());
    },

    async signOut() {
      const s = session;
      clearSession();
      if (!s) return;
      try {
        await fetch(`${base}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${s.accessToken}` },
        });
      } catch { /* オフラインでも手元のログアウトは済ませる */ }
    },

    async push(records) {
      for (let i = 0; i < records.length; i += 500) {
        const rows = records.slice(i, i + 500).map((r) => ({
          user_id: session.userId,
          kind: r.kind,
          id: r.id,
          data: r.data,
          updated_at: r.updatedAt,
          deleted: !!r.deleted,
        }));
        await api('/rest/v1/records?on_conflict=user_id,kind,id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(rows),
        });
      }
    },

    async pull(since) {
      const from = since ? new Date(Date.parse(since) - PULL_OVERLAP_MS).toISOString() : null;
      const records = [];
      let cursor = since;
      for (let offset = 0; ; offset += PAGE) {
        const q = new URLSearchParams({
          select: 'kind,id,data,updated_at,deleted,server_at',
          order: 'server_at.asc',
          limit: String(PAGE),
          offset: String(offset),
        });
        if (from) q.set('server_at', `gt.${from}`);
        const rows = await (await api(`/rest/v1/records?${q}`)).json();
        for (const row of rows) {
          records.push({
            kind: row.kind,
            id: row.id,
            data: row.data || {},
            // 端末側と同じ形式(ミリ秒までのISO)にそろえ、文字列比較できるようにする
            updatedAt: new Date(row.updated_at).toISOString(),
            deleted: !!row.deleted,
          });
          const at = new Date(row.server_at).toISOString();
          if (!cursor || at > cursor) cursor = at;
        }
        if (rows.length < PAGE) break;
      }
      return { records, cursor };
    },
  };
}
