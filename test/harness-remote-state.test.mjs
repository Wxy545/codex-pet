import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, linkSync, lstatSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {prepareHarnessRemoteState, patchHarnessRemoteState, installHarnessRemoteState} from '../harness/native-remote-state.mjs';

const ANCHOR = 'const lock = new LockStore({ onChange: (petId, data) => state.writePet(petId, "lock", data) });';
const actual = readFileSync(new URL('../node_modules/dsh-pet/lib/index.js', import.meta.url), 'utf8');
const synthetic = 'function apply(ctx){\n' + ANCHOR + '\n}';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pet-harness-qq-state-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  const profileDir = join(root, 'profile'), pkg = join(profileDir, 'node_modules/dsh-pet'), dataRoot = join(root, 'data'), sourceRoot = join(dataRoot, 'harness-plugin');
  mkdirSync(join(pkg, 'lib'), {recursive: true}); mkdirSync(sourceRoot, {recursive: true});
  writeFileSync(join(profileDir, 'package.json'), '{}');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({name: 'dsh-pet', version: '0.3.8', exports: {'./package.json': './package.json'}}));
  writeFileSync(join(pkg, 'lib/index.js'), synthetic);
  const bridge = join(sourceRoot, 'bridge.json'), activity = join(dataRoot, 'qq-activity.json');
  writeFileSync(bridge, JSON.stringify({schemaVersion: 1, dataRoot}));
  return {root, profileDir, pkg, dataRoot, sourceRoot, bridge, activity};
}
const metadata = (now, state = 'working', application = 'harness') => ({schemaVersion: 1, application, state, activeCount: ['thinking', 'working', 'waiting', 'result'].includes(state) ? 1 : 0, at: now});
function timerFixture() {
  let now = 1_000_000, id = 0; const tasks = new Map();
  return {now: () => now, tasks,
    setTimeout(fn, delay) {const key = ++id; tasks.set(key, {fn, at: now + delay}); return key;}, clearTimeout(key) {tasks.delete(key);},
    advance(ms) {now += ms; for (const [key, item] of [...tasks]) if (item.at <= now) {tasks.delete(key); item.fn();}},
  };
}

test('固定真实源码补丁幂等，只原子替换选中profile，保留pnpm共享硬链原文', t => {
  const f = fixture(t), file = join(f.pkg, 'lib/index.js'), outside = join(f.root, 'shared-index.js'); writeFileSync(file, actual); linkSync(file, outside);
  const first = prepareHarnessRemoteState({profileDir: f.profileDir}); assert.equal(first.status, 'updated'); assert.deepEqual(first.files, ['lib/index.js']);
  assert.equal(readFileSync(outside, 'utf8'), actual); assert.notEqual(lstatSync(file).ino, lstatSync(outside).ino);
  const patched = readFileSync(file, 'utf8'); assert.match(patched, /codexPetQQState/); assert.match(patched, /codex-pet-qq/);
  const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], {input: patched, encoding: 'utf8', windowsHide: true}); assert.equal(syntax.status, 0, syntax.stderr);
  assert.equal(prepareHarnessRemoteState({profileDir: f.profileDir}).status, 'current'); assert.equal(readFileSync(file, 'utf8'), patched);
  assert.equal(patchHarnessRemoteState(patched), patched);
});

test('锚点不符或包版本变化时停止，内部目录越界链接不写入外部', t => {
  const f = fixture(t), file = join(f.pkg, 'lib/index.js'); writeFileSync(file, 'unknown upstream');
  assert.throws(() => prepareHarnessRemoteState({profileDir: f.profileDir}), /anchor/); assert.equal(readFileSync(file, 'utf8'), 'unknown upstream');
  writeFileSync(join(f.pkg, 'package.json'), JSON.stringify({name: 'dsh-pet', version: '0.3.9', exports: {'./package.json': './package.json'}}));
  assert.throws(() => prepareHarnessRemoteState({profileDir: f.profileDir}), /0\.3\.8/);
  writeFileSync(join(f.pkg, 'package.json'), JSON.stringify({name: 'dsh-pet', version: '0.3.8', exports: {'./package.json': './package.json'}}));
  const external = join(f.root, 'outside'); mkdirSync(external); writeFileSync(join(external, 'index.js'), synthetic); rmSync(join(f.pkg, 'lib'), {recursive: true}); symlinkSync(external, join(f.pkg, 'lib'), 'junction');
  assert.throws(() => prepareHarnessRemoteState({profileDir: f.profileDir}), /outside-profile/); assert.equal(readFileSync(join(external, 'index.js'), 'utf8'), synthetic);
});

function serviceFixture() {
  const timers = timerFixture(), disposers = [], services = {}, publishes = [];
  const start = actual.indexOf('const WORK_STATUS_PRIORITY ='), end = actual.indexOf('//#endregion', actual.indexOf('var WorkStatusStore = class'));
  assert.ok(start >= 0 && end > start);
  const context = {Date: class extends Date {static now() {return timers.now();}}, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, ctx: {provide(name, service) {services[name] = service;}, on(name, callback) {if (name === 'dispose') disposers.push(callback);}}, publishes};
  vm.createContext(context); vm.runInContext(actual.slice(start, end) + '\nvar workStatus = new WorkStatusStore(); var publishWorkStatus=()=>publishes.push({...workStatus.snapshot()});', context);
  const patch = patchHarnessRemoteState(synthetic), from = patch.indexOf('/* codex-pet-native-remote-state-v1 */'), to = patch.indexOf(ANCHOR);
  vm.runInContext(patch.slice(from, to), context);
  return {timers, service: services.codexPetQQState, context, disposers, publishes,
    seedNative() {vm.runInContext('workStatus.setState("native-owned", "working", 1); workStatus.setTask("native-owned", "Native task");', context);},
    snap() {return JSON.parse(vm.runInContext('JSON.stringify(workStatus.snapshot())', context));},
    native() {return vm.runInContext('workStatus.taskOf("native-owned")', context);},
  };
}

test('QQ独立槽参与原优先级，idle、超时与dispose仅清自己的状态', () => {
  const f = serviceFixture(); f.seedNative(); const now = f.timers.now();
  f.service.update(metadata(now, 'waiting')); assert.equal(f.snap().state, 'waiting'); assert.equal(f.native(), 'Native task');
  f.service.update(metadata(now, 'idle')); assert.equal(f.snap().state, 'working'); assert.equal(f.snap().task, 'Native task');
  f.service.update(metadata(now, 'waiting')); f.timers.advance(30_001); assert.equal(f.snap().state, 'working'); assert.equal(f.native(), 'Native task');
  f.service.update(metadata(f.timers.now(), 'waiting')); f.timers.advance(10000); f.service.update(metadata(f.timers.now(), 'waiting'));
  f.timers.advance(25000); assert.equal(f.snap().state, 'waiting'); f.timers.advance(5001); assert.equal(f.snap().state, 'working');
  f.service.update(metadata(f.timers.now(), 'waiting')); f.disposers.forEach(dispose => dispose()); assert.equal(f.snap().state, 'working'); assert.equal(f.timers.tasks.size, 0);
});

test('过期、未来、跨宿主和混入正文的metadata不能占槽，终态五秒后退回原生状态', () => {
  const f = serviceFixture(); f.seedNative(); const now = f.timers.now();
  for (const view of [metadata(now - 30_001, 'waiting'), metadata(now + 1, 'waiting'), metadata(now, 'waiting', 'codex'), {...metadata(now, 'waiting'), text: 'private synthetic message'}, {...metadata(now, 'waiting'), activeCount: 0}]) {f.service.update(view); assert.equal(f.snap().state, 'working');}
  f.service.update(metadata(now, 'error')); assert.equal(f.snap().state, 'error'); f.timers.advance(5001); assert.equal(f.snap().state, 'working');
  assert.equal(f.native(), 'Native task');
});

function pollFixture(t, f, options = {}) {
  const updates = [], ticks = new Map(), callbacks = [], contexts = []; let serial = 0, now = 1_000_000;
  const service = {update(value) {updates.push(value);}};
  const ctx = {inject(names, apply) {assert.deepEqual(names, ['codexPetQQState']); const inner = {get: name => name === 'codexPetQQState' ? service : undefined, on(event, handler) {if (event === 'dispose') contexts.push(handler);}}; apply(inner); return {dispose() {contexts.forEach(handler => handler());}};}, on(event, handler) {if (event === 'dispose') callbacks.push(handler);}};
  const installed = installHarnessRemoteState(ctx, {sourceRoot: f.sourceRoot, locale: 'en', now: () => now,
    timers: {setInterval(fn, ms) {assert.equal(ms, 1500); const id = ++serial; ticks.set(id, fn); return id;}, clearInterval(id) {ticks.delete(id);}}, ...options});
  t.after(() => installed.dispose());
  return {updates, ticks, installed, tick() {for (const callback of ticks.values()) callback();}, time(value) {now = value;}, dispose() {callbacks.forEach(callback => callback());}};
}

test('私有bridge绑定真实父data目录，轮询只投影五字段且dispose清槽', t => {
  const f = fixture(t); writeFileSync(f.activity, JSON.stringify(metadata(1_000_000, 'waiting'))); const p = pollFixture(t, f);
  assert.equal(p.installed.status, 'installed'); assert.deepEqual(p.updates.at(-1), metadata(1_000_000, 'waiting'));
  p.time(1_030_001); p.tick(); assert.equal(p.updates.at(-1), null);
  writeFileSync(f.activity, JSON.stringify({...metadata(1_030_001), threadId: 'must-never-be-read-as-metadata'})); p.tick(); assert.equal(p.updates.at(-1), null);
  p.dispose(); assert.equal(p.ticks.size, 0); assert.equal(p.updates.at(-1), null);
});

test('状态文件或bridge是硬链、超大文件以及dataRoot越界均不接入', t => {
  const f = fixture(t); const external = join(f.root, 'external-metadata.json'); writeFileSync(external, JSON.stringify(metadata(1_000_000)));
  linkSync(external, f.activity); const hard = pollFixture(t, f); assert.equal(hard.updates.at(-1), null); hard.installed.dispose(); rmSync(f.activity);
  writeFileSync(f.activity, 'x'.repeat(4096)); const large = pollFixture(t, f); assert.equal(large.updates.at(-1), null); large.installed.dispose();
  writeFileSync(f.bridge, JSON.stringify({schemaVersion: 1, dataRoot: f.root})); const outside = pollFixture(t, f); assert.equal(outside.installed.status, 'unavailable'); assert.equal(outside.ticks.size, 0);
  rmSync(f.bridge); linkSync(external, f.bridge); const bridgeLink = pollFixture(t, f); assert.equal(bridgeLink.installed.status, 'unavailable'); assert.equal(bridgeLink.ticks.size, 0);
});

test('状态文件是文件符号链接时拒绝读取', t => {
  const f = fixture(t), external = join(f.root, 'outside-state.json'); writeFileSync(external, JSON.stringify(metadata(1_000_000)));
  try {symlinkSync(external, f.activity);} catch (error) {if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {t.skip('当前Windows用户没有创建文件符号链接权限'); return;} throw error;}
  const linked = pollFixture(t, f); assert.equal(linked.updates.at(-1), null);
});
