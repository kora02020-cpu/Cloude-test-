// 同期の進行役。同期先(adapter)の違いはここで吸収する。
// adapter: { enabled, signedIn(), push(records), pull(since) → { records, cursor } }
export function startSync(store, adapter) {
  let running = false;
  let queued = false;
  let timer = null;

  const set = (state, message = '') => store.setStatus({ state, message, pending: store.pendingCount() });

  function idleState() {
    if (!adapter.enabled) return 'local';
    if (!navigator.onLine) return 'offline';
    if (!adapter.signedIn()) return 'signedout';
    return null;
  }

  async function run() {
    if (running) { queued = true; return; }
    const idle = idleState();
    if (idle) { set(idle); return; }

    running = true;
    set('saving');
    try {
      const sent = store.pending();
      if (sent.length) {
        await adapter.push(sent);
        store.markPushed(sent);
      }
      const { records, cursor } = await adapter.pull(store.meta().since || null);
      store.applyRemote(records);
      if (cursor) store.setMeta({ since: cursor });
      set(store.pendingCount() ? 'saving' : 'saved');
    } catch (e) {
      if (e.auth) set('signedout', e.message);
      else if (!navigator.onLine || e instanceof TypeError) set('offline');
      else set('error', e.message);
    } finally {
      running = false;
      if (queued) { queued = false; schedule(300); }
    }
  }

  function schedule(ms = 600) {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  store.onLocalWrite = () => {
    set(idleState() || 'saving');
    schedule();
  };

  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', () => set(idleState() || 'offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(0);
  });
  setInterval(() => schedule(0), 5 * 60 * 1000);
  run();

  return {
    adapter,
    syncNow: () => schedule(0),
  };
}
