import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localizeIndexHtml} from '../scripts/runtime-locale-patches.mjs';
const clean=readFileSync(new URL('./fixtures/upstream-desktop-scripts.html',import.meta.url),'utf8');
const scripts=source=>[...source.matchAll(/<script src="(?:\.\/)?([^"]+)"/g)].map(match=>match[1]);
const expected=['shared-core.js','constants.js','sprite.js','locale-en.cjs','codex-locale.cjs','skin-actions.cjs','codex-skin-renderer.js','events.js','renderer.js'];
test('干净上游HTML的locale先于renderer，且自有脚本只加载一次',()=>{
 const fixed=localizeIndexHtml(clean);assert.deepEqual(scripts(fixed),expected);assert.match(fixed,/<title>Codex Pet<\/title>/);
 assert.equal(localizeIndexHtml(fixed),fixed);
});
test('旧helper乱序及重复标签统一重建，保留非自有脚本顺序',()=>{
 const bad=clean.replace('<script src="./sprite.js"></script>','<script src="./sprite.js"></script>\n<script src="skin-actions.cjs"></script>\n<script src="codex-skin-renderer.js"></script>\n<script src="locale-en.cjs"></script>\n<script src="codex-locale.cjs"></script>\n<script src="./codex-locale.cjs"></script>');
 const fixed=localizeIndexHtml(bad);assert.deepEqual(scripts(fixed),expected);assert.equal(localizeIndexHtml(fixed),fixed);
});
test('固定版本sprite锚点缺失或重复时停止，避免静默保留错误依赖顺序',()=>{
 assert.throws(()=>localizeIndexHtml('<html></html>'),/锚点/);
 assert.throws(()=>localizeIndexHtml(clean+clean),/锚点/);
});
test('已准备的实际helper保持同一加载顺序，renderer不早于语言模块',()=>{
 const actual=readFileSync(new URL('../node_modules/dsh-pet/runtime/electron-helper/index.html',import.meta.url),'utf8');
 const owned=new Set(['sprite.js','locale-en.cjs','codex-locale.cjs','skin-actions.cjs','codex-skin-renderer.js']);
 assert.deepEqual(scripts(actual).filter(file=>owned.has(file)),['sprite.js','locale-en.cjs','codex-locale.cjs','skin-actions.cjs','codex-skin-renderer.js']);
});
