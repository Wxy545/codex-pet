import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Script } from 'node:vm';
import { patchBrowserMouseRelease } from '../harness/browser-drag-fix.mjs';
import { prepareHarnessDependency } from '../harness/motion-fix.mjs';

const upstream = name => fs.readFileSync(new URL('../node_modules/dsh-pet/' + name, import.meta.url), 'utf8');
const profileMain = () => upstream('runtime/electron-helper/main.js').replace(/\/\/ codex-pet-helper-profile-v1:(?:true|false)\n[\s\S]*?(?=\/\/ ② 宿主探测)/, '');
const files = ['lib/client.js', 'runtime/electron-helper/sprite.js', 'runtime/electron-helper/main.js'];
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'harness-runtime-fixes-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = join(root, 'profile'), pkg = join(profile, 'node_modules', 'dsh-pet');
  fs.mkdirSync(pkg, { recursive: true }); fs.writeFileSync(join(profile, 'package.json'), '{"private":true}');
  fs.writeFileSync(join(pkg, 'package.json'), '{"name":"dsh-pet","version":"0.3.8","exports":{"./package.json":"./package.json"}}');
  const original = {};
  for (const name of files) { const target = join(pkg, name); fs.mkdirSync(dirname(target), { recursive: true }); original[name] = name.endsWith('main.js') ? profileMain() : upstream(name); fs.writeFileSync(target, original[name]); }
  return { root, profile, pkg, original };
}

test('浏览器补丁命中真实0.3.8编译代码、幂等，错误或重复锚点停止', () => {
  const source = upstream('lib/client.js'), patched = patchBrowserMouseRelease(source);
  assert.equal(patchBrowserMouseRelease(patched), patched);
  assert.throws(() => patchBrowserMouseRelease(patched.replace('if (listener) window.removeEventListener', 'if (listener && true) window.removeEventListener')), /anchor-mismatch/);
  assert.throws(() => patchBrowserMouseRelease(patched.replace('else clearMouseRelease();', 'else { clearMouseRelease(); }')), /anchor-mismatch/);
  // client本身为ES模块；去掉唯一导出声明后检查其余实际脚本。
  new Script(patched.replace(/^export\s*\{[^}]*\};?\s*$/m, ''));
  assert.match(patched, /else clearMouseRelease\(\);/);
  assert.throws(() => patchBrowserMouseRelease(source.replace('const handlePointerDown = (e)', 'const changedDown = (e)')), /anchor-mismatch/);
  assert.throws(() => patchBrowserMouseRelease(source + source), /anchor-mismatch/);
  assert.throws(() => patchBrowserMouseRelease(source.replace('e.currentTarget.classList.remove("dragging")', 'e.changedTarget.classList.remove("dragging")')), /anchor-mismatch/);
});

function mouseHarness() {
  const patched = patchBrowserMouseRelease(upstream('lib/client.js'));
  const helpers = patched.slice(patched.indexOf('\t\t// codex-pet-browser-mouse-release-v1:'), patched.indexOf('\t\tconst handlePointerDown = (e) => {'));
  const release = patched.slice(patched.indexOf('\t\tconst settlePointerRelease = (point) => {'), patched.indexOf('\t\tconst handleClick = () => {'));
  const listeners = new Set(), effects = [], calls = { stops: 0, removed: 0, dragging: [], places: [], tips: [] };
  const dragRef = { current: { active: true, dragging: true, sling: false, offX: 0, offY: 0 } };
  const hit = { classList: { remove() { calls.removed++; } }, getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) };
  const deps = {
    window: { addEventListener(type, fn) { assert.equal(type, 'mouseup'); listeners.add(fn); }, removeEventListener(type, fn) { assert.equal(type, 'mouseup'); listeners.delete(fn); }, innerWidth: 500, innerHeight: 500 },
    useRef: value => ({ current: value }), useEffect: effect => effects.push(effect), dragRef,
    stopDragFollow: () => calls.stops++, justDraggedRef: { current: false }, setTimeout: () => 0, setDragging: value => calls.dragging.push(value),
    stageRef: { current: null }, bottomPad: 0, resumeWorkStatusAnim: () => false, petAnims: { idle: [] }, pick() {}, setAnim() {}, animRef: { current: 'idle' }, setOnce() {},
    boxPxRef: { current: { x: 20, y: 30 } }, halfW: 10, halfH: 10, slingshotPower() {}, slingshotVelocity() {}, pullAngle() {}, cfg: { physics: {} },
    dragTrailRef: { current: [] }, console: { log() {} }, startThrow() { throw Error('unexpected-throw'); }, estimateReleaseVelocity: () => null,
    setCustomPos: value => calls.places.push(value), placeTip: (...args) => calls.tips.push(args), setTipOn() {}, performance: { now: () => 1 },
  };
  const names = Object.keys(deps);
  const api = new Function(...names, helpers + release + '\nreturn {arm:armMouseRelease,up:handlePointerUp};')(...names.map(name => deps[name]));
  return { ...api, hit, listeners, calls, dragRef, unmount: () => effects.forEach(effect => effect()()), mouseup: event => [...listeners].forEach(fn => fn({ button: 0, buttons: 0, clientX: 40, clientY: 50, ...event })) };
}

test('丢失pointerup只收到window mouseup也收尾一次；仍按左键时不释放', () => {
  const f = mouseHarness(); f.arm(f.hit); assert.equal(f.listeners.size, 1);
  f.mouseup({ button: 2, buttons: 1 }); assert.equal(f.dragRef.current.active, true);
  f.mouseup({}); assert.equal(f.dragRef.current.active, false); assert.equal(f.listeners.size, 0); assert.equal(f.calls.stops, 1); assert.equal(f.calls.places.length, 1);
  f.up({ currentTarget: f.hit, clientX: 40, clientY: 50 }); assert.equal(f.calls.places.length, 1);
});

test('左右键组合时松左仍收尾，随后松右不重复结算', () => {
  const f = mouseHarness(); f.arm(f.hit);
  f.mouseup({ button: 0, buttons: 2 }); assert.equal(f.dragRef.current.active, false); assert.equal(f.calls.places.length, 1);
  f.mouseup({ button: 2, buttons: 0 }); assert.equal(f.calls.places.length, 1); assert.equal(f.listeners.size, 0);
});

test('正常up/cancel与卸载摘掉监听，重复按下不累积，卸载后不再结算', () => {
  const f = mouseHarness(); f.arm(f.hit); f.arm(f.hit); assert.equal(f.listeners.size, 1);
  f.up({ currentTarget: f.hit, clientX: 40, clientY: 50 }); assert.equal(f.listeners.size, 0); assert.equal(f.calls.places.length, 1);
  const other = mouseHarness(); other.arm(other.hit); other.unmount(); assert.equal(other.listeners.size, 0); other.mouseup({}); assert.equal(other.calls.places.length, 0);
});

test('触屏长按菜单已清active时仍移除拖拽样式，不重复运动结算', () => {
  const f = mouseHarness(); f.dragRef.current.active = false; f.dragRef.current.dragging = false;
  f.up({ currentTarget: f.hit, clientX: 40, clientY: 50 });
  assert.equal(f.calls.removed, 1); assert.equal(f.calls.stops, 0); assert.equal(f.calls.places.length, 0);
});

test('Harness先核对所有文件再写，坏main不留下半套client或sprite补丁', t => {
  const f = fixture(t); const main = join(f.pkg, 'runtime/electron-helper/main.js');
  fs.writeFileSync(main, f.original['runtime/electron-helper/main.js'].replace('// ② 宿主探测：', '// changed:'));
  assert.throws(() => prepareHarnessDependency({ profileDir: f.profile }), /anchor-mismatch/);
  for (const name of files.slice(0, 2)) assert.equal(fs.readFileSync(join(f.pkg, name), 'utf8'), f.original[name]);
});

test('Harness原子更新断开所有已改文件硬链接，保留共享store与其它profile，第二次无写入', t => {
  const f = fixture(t), store = join(f.root, 'store'); fs.mkdirSync(store);
  for (const [index, name] of files.entries()) fs.linkSync(join(f.pkg, name), join(store, String(index)));
  const first = prepareHarnessDependency({ profileDir: f.profile }); assert.equal(first.status, 'updated');
  assert.ok(first.files.includes('lib/client.js')); assert.ok(first.files.includes('runtime/electron-helper/main.js'));
  for (const [index, name] of files.entries()) {
    assert.equal(fs.readFileSync(join(store, String(index)), 'utf8'), f.original[name]);
    if (first.files.includes(name)) assert.notEqual(fs.statSync(join(f.pkg, name)).ino, fs.statSync(join(store, String(index))).ino);
  }
  const snapshots = files.map(name => fs.statSync(join(f.pkg, name)));
  assert.equal(prepareHarnessDependency({ profileDir: f.profile }).status, 'current');
  files.forEach((name, index) => assert.equal(fs.statSync(join(f.pkg, name)).ino, snapshots[index].ino));
  assert.deepEqual(fs.readdirSync(join(f.pkg, 'runtime/electron-helper')).filter(name => name.includes('.dragon-')), []);
});
