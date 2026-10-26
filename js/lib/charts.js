// SVG の棒グラフと表を自作する小さなライブラリ。
// spec = {
//   groups: [{ key, label, detail, emphasis, bars: [{ value, color, name }] }],
//   mode: 'grouped' | 'stacked', height, refLine, selectedKey, showValues,
//   ariaLabel, onSelect(key)
// }
import { COLORS } from '../config.js';
import { esc, num, sum } from './logic.js';

const hosts = new Set();
const observer = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver((entries) => {
    for (const e of entries) {
      const host = e.target;
      if (host._spec && Math.round(e.contentRect.width) !== host._width) draw(host);
    }
  })
  : null;

export function renderBarChart(host, spec) {
  host._spec = spec;
  if (!hosts.has(host)) {
    hosts.add(host);
    observer?.observe(host);
    host.addEventListener('click', (e) => {
      const t = e.target.closest('[data-key]');
      if (t) host._spec.onSelect?.(t.dataset.key);
    });
    host.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target.closest('[data-key]');
      if (!t) return;
      e.preventDefault();
      host._spec.onSelect?.(t.dataset.key);
    });
  }
  draw(host);
}

function draw(host) {
  const spec = host._spec;
  const W = Math.max(240, Math.round(host.clientWidth || 320));
  host._width = W;
  const H = spec.height || 150;
  const top = spec.showValues ? 20 : 10;
  const bottom = 26;
  const plotH = H - top - bottom;
  const groups = spec.groups;
  const band = W / Math.max(1, groups.length);
  const stacked = spec.mode === 'stacked';
  const totals = groups.map((g) => (stacked
    ? sum(g.bars, (b) => b.value)
    : Math.max(0, ...g.bars.map((b) => num(b.value)))));
  const max = Math.max(1, num(spec.refLine), ...totals);
  const h = (v) => (num(v) / max) * plotH;
  const base = top + plotH;

  const parts = [];
  groups.forEach((g, i) => {
    const x0 = i * band;
    const isSel = spec.selectedKey === g.key;
    if (g.emphasis || isSel) {
      parts.push(`<rect x="${x0 + 3}" y="2" width="${band - 6}" height="${H - 4}" rx="8"
        fill="${g.emphasis ? '#1f2630' : 'none'}" ${isSel ? `stroke="${COLORS.muted}" stroke-width="1"` : ''}/>`);
    }
    if (stacked) {
      const bw = Math.min(30, band * 0.5);
      const bx = x0 + (band - bw) / 2;
      let y = base;
      g.bars.forEach((b) => {
        const bh = h(b.value);
        if (bh <= 0) return;
        y -= bh;
        parts.push(`<rect x="${bx}" y="${y}" width="${bw}" height="${bh}" fill="${b.color}"/>`);
      });
      if (spec.showValues && totals[i] > 0 && spec.formatTotal) {
        parts.push(`<text class="v" x="${x0 + band / 2}" y="${y - 5}" text-anchor="middle">${esc(spec.formatTotal(totals[i]))}</text>`);
      }
    } else {
      const k = g.bars.length;
      const gap = 4;
      const bw = Math.min(18, (band * 0.62 - gap * (k - 1)) / k);
      const gx = x0 + (band - (bw * k + gap * (k - 1))) / 2;
      g.bars.forEach((b, j) => {
        const v = num(b.value);
        const bh = v > 0 ? Math.max(2, h(v)) : 0;
        const bx = gx + j * (bw + gap);
        if (bh > 0) parts.push(`<rect x="${bx}" y="${base - bh}" width="${bw}" height="${bh}" rx="3" fill="${b.color}"/>`);
        if (spec.showValues && v > 0) {
          parts.push(`<text class="v" x="${bx + bw / 2}" y="${base - bh - 5}" text-anchor="middle">${v}</text>`);
        }
      });
    }
    parts.push(`<text class="l${g.emphasis ? ' em' : ''}" x="${x0 + band / 2}" y="${H - 8}" text-anchor="middle">${esc(g.label)}</text>`);
    parts.push(`<rect class="hit" data-key="${esc(g.key)}" x="${x0}" y="0" width="${band}" height="${H}"
      fill="transparent" role="button" tabindex="0" aria-pressed="${isSel}" aria-label="${esc(g.detail || g.label)}"/>`);
  });

  const ref = num(spec.refLine) > 0
    ? `<line x1="0" x2="${W}" y1="${base - h(spec.refLine)}" y2="${base - h(spec.refLine)}" stroke="${COLORS.muted}" stroke-dasharray="3 4" stroke-width="1"/>`
    : '';

  host.innerHTML = `<svg class="chart-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-label="${esc(spec.ariaLabel || '')}">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="${COLORS.track}" stroke-width="1"/>
    ${ref}${parts.join('')}
  </svg>`;
}

// 横1本の積み上げバー(構成比)
export function stackBar(segments, total) {
  if (!(num(total) > 0)) {
    return `<svg class="stack-svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      <rect width="100" height="10" fill="${COLORS.track}"/></svg>`;
  }
  let x = 0;
  const rects = segments.filter((s) => s.amount > 0).map((s) => {
    const w = (s.amount / total) * 100;
    const r = `<rect x="${x}" y="0" width="${w}" height="10" fill="${s.color}"/>`;
    x += w;
    return r;
  }).join('');
  return `<svg class="stack-svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
}

// columns: [{ label, align }], rows: [[cell, ...]]  cell は表示用文字列
export function tableHTML(caption, columns, rows) {
  const head = columns.map((c) => `<th scope="col" class="${c.align === 'right' ? 'r' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((cell, i) => (i === 0
    ? `<th scope="row">${esc(cell)}</th>`
    : `<td class="${columns[i].align === 'right' ? 'r' : ''}">${esc(cell)}</td>`)).join('')}</tr>`).join('');
  return `<table class="data-table"><caption class="sr-only">${esc(caption)}</caption>
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
