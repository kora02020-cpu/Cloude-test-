// 同期状態の表示(ヘッダーの小さなボタン)と、ログイン/同期のシート
import { esc } from '../lib/logic.js';
import { $ } from './dom.js';

const LABELS = {
  local: '端末に保存',
  connecting: '接続中…',
  saved: '保存済み',
  saving: '保存中…',
  offline: 'オフライン',
  signedout: '未ログイン',
  error: '同期エラー',
};

export function mount(ctx) {
  const btn = $('#sync-status');
  const dialog = $('#sync-dialog');

  ctx.store.onStatus((s) => {
    btn.dataset.state = s.state;
    let label = LABELS[s.state] || s.state;
    if ((s.state === 'offline' || s.state === 'error') && s.pending > 0) label += ` · 未送信 ${s.pending}`;
    btn.querySelector('.sync-label').textContent = label;
    btn.setAttribute('aria-label', `同期状態:${label}。タップで詳細`);
    if (dialog.open) renderDialog(ctx);
  });

  btn.addEventListener('click', () => {
    renderDialog(ctx);
    dialog.showModal();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
}

function renderDialog(ctx) {
  const body = $('#sync-dialog-body');
  const { adapter } = ctx.sync;
  const s = ctx.store.status();
  const pending = ctx.store.pendingCount();
  const head = `<div class="sheet-head"><h2 id="sync-dialog-title">同期</h2>
    <button class="btn ghost small" type="button" data-close>閉じる</button></div>`;

  if (!adapter.enabled) {
    body.innerHTML = `${head}
      <p>同期は未設定です。記録はこの端末の中にだけ保存されています。</p>
      <p class="note">端末をまたいで使うには、README の「同期の設定」に沿って <code>js/config.js</code> に Supabase の URL とキーを設定してください。設定前の記録も、ログイン後にまとめて送られます(未送信 ${pending} 件)。</p>`;
    return;
  }

  if (adapter.kind === 'claude') {
    body.innerHTML = `${head}
      <p>claude.ai のアカウントで同期しています。同じアカウントで開いた iPhone と iPad に、同じ記録が表示されます。</p>
      <dl class="kv">
        <dt>状態</dt><dd>${esc(LABELS[s.state] || s.state)}${s.message ? `(${esc(s.message)})` : ''}</dd>
        <dt>未送信</dt><dd>${pending} 件</dd>
      </dl>
      <div class="btn-row"><button class="btn primary" type="button" id="sync-now">今すぐ同期</button></div>`;
    $('#sync-now').addEventListener('click', () => ctx.sync.syncNow());
    return;
  }

  if (!adapter.signedIn()) {
    // 再描画で入力中の内容を消さない
    if (body.querySelector('#login-form')) return;
    body.innerHTML = `${head}
      <form class="form" id="login-form" novalidate>
        <label class="field"><span>メールアドレス</span>
          <input type="email" name="email" autocomplete="username" required></label>
        <label class="field"><span>パスワード</span>
          <input type="password" name="password" autocomplete="current-password" required></label>
        <p class="form-msg" aria-live="polite">${s.message ? esc(s.message) : ''}</p>
        <button class="btn primary block" type="submit">ログイン</button>
      </form>
      <p class="note">未送信 ${pending} 件。ログインすると、この端末の記録とサーバーの記録が合わさります。</p>`;
    const form = $('#login-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = form.querySelector('.form-msg');
      const submit = form.querySelector('button[type=submit]');
      submit.disabled = true;
      msg.textContent = 'ログイン中…';
      try {
        await adapter.signIn(form.email.value.trim(), form.password.value);
        ctx.store.enqueueAll();
        ctx.store.setMeta({ since: null });
        ctx.sync.syncNow();
        renderDialog(ctx);
      } catch (err) {
        msg.textContent = err.message || 'ログインできませんでした';
        submit.disabled = false;
      }
    });
    return;
  }

  body.innerHTML = `${head}
    <dl class="kv">
      <dt>アカウント</dt><dd>${esc(adapter.email())}</dd>
      <dt>状態</dt><dd>${esc(LABELS[s.state] || s.state)}${s.message ? `(${esc(s.message)})` : ''}</dd>
      <dt>未送信</dt><dd>${pending} 件</dd>
    </dl>
    <div class="btn-row">
      <button class="btn primary" type="button" id="sync-now">今すぐ同期</button>
      <button class="btn ghost" type="button" id="sign-out">ログアウト</button>
    </div>
    <p class="note">ログアウトしても、この端末の記録は残ります。</p>`;
  $('#sync-now').addEventListener('click', () => ctx.sync.syncNow());
  $('#sign-out').addEventListener('click', async () => {
    await adapter.signOut();
    ctx.sync.syncNow();
    renderDialog(ctx);
  });
}
