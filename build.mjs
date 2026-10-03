// 打包成單一 HTML：node build.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  legalComments: 'none',
  write: false,
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const css = readFileSync('src/styles.css', 'utf8');
const html = readFileSync('src/index.html', 'utf8')
  .replace('/*__STYLE__*/', () => css)
  .replace('/*__SCRIPT__*/', () => js);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/tianji-mingpu.html', html);
console.log(`dist/tianji-mingpu.html  ${(html.length / 1024).toFixed(0)} KB`);
