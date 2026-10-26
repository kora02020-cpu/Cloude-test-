// 画面部品で共通に使う小物。
export const $ = (sel, root = document) => root.querySelector(sel);

// 「2回タップで削除」。1回目で確認表示に切り替え、3秒で元に戻る
export function createConfirmDelete(onConfirm, rerender) {
  let armed = null;
  let timer = null;
  return {
    isArmed: (id) => armed === id,
    tap(id) {
      clearTimeout(timer);
      if (armed === id) {
        armed = null;
        onConfirm(id);
        return;
      }
      armed = id;
      rerender();
      timer = setTimeout(() => { armed = null; rerender(); }, 3000);
    },
  };
}

export function deleteButton(id, armed, what) {
  return `<button class="btn del${armed ? ' armed' : ''}" type="button" data-del="${id}"
    aria-label="${armed ? `もう一度タップで${what}を削除` : `${what}を削除`}">${armed ? 'もう一度で削除' : '削除'}</button>`;
}

export function setMsg(form, text, ok = false) {
  const el = form.querySelector('.form-msg');
  el.textContent = text;
  el.classList.toggle('ok', ok);
}

// '1,200' や全角数字も受け付ける
export function parseNumber(s) {
  const t = String(s ?? '')
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s円ptP]/g, '');
  if (t === '') return NaN;
  return Number(t);
}
