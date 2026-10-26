// 集計と歩合の計算。入力が空・不正でも NaN を返さないようにしている。
import { COMMISSION_TIERS, CATEGORIES } from '../config.js';

export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const sum = (list, pick) => list.reduce((acc, x) => acc + num(pick(x)), 0);

export const ratio = (n, d) => (num(d) > 0 ? num(n) / num(d) : 0);

// 現在のポイント以下で最大の段階を適用、次の段階は現在より大きい最小の段階
export function commission(points, tiers = COMMISSION_TIERS) {
  const p = num(points);
  let current = null;
  let next = null;
  for (const t of tiers) {
    if (t.points <= p) current = t;
    else { next = t; break; }
  }
  const yen = current ? current.yen : 0;
  return {
    current,
    next,
    yen,
    remaining: next ? next.points - p : 0,
    gain: next ? next.yen - yen : 0,
  };
}

export function byCategory(expenses, categories = CATEGORIES) {
  const total = sum(expenses, (e) => e.amount);
  return categories.map((c) => {
    const amount = sum(expenses.filter((e) => e.cat === c.id), (e) => e.amount);
    return { ...c, amount, share: ratio(amount, total) };
  });
}

export function yen(n) {
  return `¥${Math.round(num(n)).toLocaleString('ja-JP')}`;
}

// ポイントは小数第1位まで
export function pts(n) {
  return (Math.round(num(n) * 10) / 10).toLocaleString('ja-JP');
}

export function pct(r) {
  return `${Math.round(num(r) * 100)}%`;
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
