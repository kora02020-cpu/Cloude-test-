// claude.ai のページ(Artifact)として公開するための1ファイル版を作る。
// ページの枠組み(doctype/head/body)は公開時に付くので、中身だけを出力する。
// 外部のCSS/JSは読み込めないため、CSSとJSをすべて埋め込む。
//   npm run build:artifact  →  dist/today-board.html
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const html = await readFile('index.html', 'utf8');
const css = await readFile('css/app.css', 'utf8');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const fonts = html.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)">/)[1];

const js = await build({
  entryPoints: ['js/main.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  legalComments: 'none',
});

const out = `<title>今日のボード</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${fonts.replace(/&amp;/g, '&')}">
<style>
${css}
/* claude.ai 上では上下の安全領域を外枠が確保する */
body { padding-top: 12px; padding-bottom: 24px; }
</style>
${body.trim()}
<script>${js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>
`;

await mkdir('dist', { recursive: true });
await writeFile('dist/today-board.html', out);
console.log(`dist/today-board.html (${(out.length / 1024).toFixed(1)} KB)`);
