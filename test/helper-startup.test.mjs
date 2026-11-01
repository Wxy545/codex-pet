import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Script, runInNewContext } from 'node:vm';
import { ensureHelperProfile, patchHelperStartup } from '../harness/helper-startup-fix.mjs';

const actualMain = () => fs.readFileSync(new URL('../node_modules/dsh-pet/runtime/electron-helper/main.js', import.meta.url), 'utf8');
const originalProfile = source => source.replace(/\/\/ codex-pet-helper-profile-v1:(?:true|false)\n[\s\S]*?(?=\/\/ ② 宿主探测)/, '');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'pet-helper-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = path.join(root, 'original'), home = path.join(root, 'home'), calls = [];
  const app = { getPath: () => current, setPath: (...args) => calls.push(args) };
  const input = { app, fileSystem: fs, path, env: { DSH_HOME: home }, home: () => root, randomUUID, appMode: true };
  return { root, current, home, calls, input };
}

test('可写原profile保持原样，探针使用独占随机文件并清理', t => {
  const f = fixture(t); fs.mkdirSync(f.current); fs.writeFileSync(path.join(f.current, 'saved.json'), 'keep');
  fs.writeFileSync(path.join(f.current, '.dsh-pet-write-probe'), 'existing-user-file');
  const result = ensureHelperProfile(f.input);
  assert.equal(result.status, 'current'); assert.equal(result.dir, f.current); assert.deepEqual(f.calls, []);
  assert.equal(fs.readFileSync(path.join(f.current, '.dsh-pet-write-probe'), 'utf8'), 'existing-user-file');
  assert.deepEqual(fs.readdirSync(f.current).sort(), ['.dsh-pet-write-probe', 'saved.json']);
  assert.equal(fs.existsSync(f.home), false);
});

test('原profile不可写才切自有fallback，独立宿主与Harness目录分开', t => {
  const f = fixture(t); fs.writeFileSync(f.current, 'not-a-directory');
  for (const appMode of [true, false]) {
    f.calls.length = 0;
    const result = ensureHelperProfile({ ...f.input, appMode });
    const expected = path.join(f.home, 'dsh-pet', appMode ? 'app-profile' : 'electron-profile');
    assert.equal(result.status, 'fallback'); assert.equal(result.dir, expected);
    assert.deepEqual(f.calls, [['userData', expected]]); assert.deepEqual(fs.readdirSync(expected), []);
  }
  assert.equal(fs.readFileSync(f.current, 'utf8'), 'not-a-directory');
});

test('getPath异常仍可选择fallback；未设DSH_HOME使用原生home', t => {
  const f = fixture(t); f.input.app.getPath = () => { throw Error('no-path'); };
  const result = ensureHelperProfile({ ...f.input, env: {}, appMode: false });
  assert.equal(result.status, 'fallback');
  assert.equal(result.dir, path.join(f.root, '.dsh', 'dsh-pet', 'electron-profile'));
  assert.deepEqual(fs.readdirSync(result.dir), []);
});

test('两处不可用、相对home或setPath失败均不报告恢复', t => {
  const f = fixture(t); fs.writeFileSync(f.current, 'original'); fs.writeFileSync(f.home, 'blocked');
  assert.equal(ensureHelperProfile(f.input).status, 'unavailable'); assert.deepEqual(f.calls, []);
  assert.equal(ensureHelperProfile({ ...f.input, env: { DSH_HOME: 'relative' } }).status, 'unavailable');
  fs.unlinkSync(f.home); f.input.app.setPath = () => { throw Error('set-path-rejected'); };
  const result = ensureHelperProfile(f.input); assert.equal(result.status, 'unavailable'); assert.equal(result.fallback, false);
});

test('写探针失败也关闭并清理本次文件，wx碰撞不会覆盖或删除他人文件', t => {
  const f = fixture(t); let created, closed = 0, removed = 0;
  const failing = { ...fs, writeFileSync(fd) { if (typeof fd === 'number') { created = true; throw Error('write-failed'); } }, closeSync(fd) { closed++; fs.closeSync(fd); }, unlinkSync(file) { removed++; fs.unlinkSync(file); } };
  assert.equal(ensureHelperProfile({ ...f.input, fileSystem: failing }).status, 'unavailable');
  assert.equal(created, true); assert.equal(closed, 2); assert.equal(removed, 2);
  assert.deepEqual(fs.readdirSync(f.current), []); assert.deepEqual(fs.readdirSync(path.join(f.home, 'dsh-pet', 'app-profile')), []);
  const existing = path.join(f.current, '.codex-pet-write-probe-collision'); fs.writeFileSync(existing, 'do-not-touch');
  const result = ensureHelperProfile({ ...f.input, randomUUID: () => 'collision' });
  assert.equal(result.status, 'fallback'); assert.equal(fs.readFileSync(existing, 'utf8'), 'do-not-touch');
});

test('实际固定0.3.8源码可补丁、可编译且幂等，错误或重复锚点停止', () => {
  const source = originalProfile(actualMain());
  for (const appMode of [true, false]) {
    const patched = patchHelperStartup(source, { appMode });
    assert.equal(patchHelperStartup(patched, { appMode }), patched); new Script(patched);
    assert.ok(patched.indexOf('// codex-pet-helper-profile-v1:') > patched.indexOf("stream.on('error'"));
    assert.ok(patched.indexOf('// codex-pet-helper-profile-v1:') < patched.indexOf('function dpiCacheFile()'));
    assert.throws(() => patchHelperStartup(patched, { appMode: !appMode }), /mode-mismatch/);
    assert.throws(() => patchHelperStartup(patched.replace('primaryError = prepare(currentDir)', 'primaryError = prepare(currentDir) || null'), { appMode }), /anchor-mismatch/);
  }
  assert.throws(() => patchHelperStartup(source.replace('// ② 宿主探测：', '// changed:'), { appMode: true }), /anchor-mismatch/);
  assert.throws(() => patchHelperStartup(source + source, { appMode: false }), /anchor-mismatch/);
  assert.throws(() => patchHelperStartup(source, {}), /options-invalid/);
});

test('生产DPI保护块在探测异常时关闭补偿且不抛出，成功时保留原倍率', () => {
  const source = patchHelperStartup(originalProfile(actualMain()), { appMode: true });
  const from = source.indexOf('if (shouldLinearize('), to = source.indexOf('/**\n * 渲染端的 CONFIG.scale', from);
  const block = source.slice(from, to);
  assert.ok(block.includes('codex-pet-dpi-startup-v1'));
  for (const failure of [true, false]) {
    let switches = 0;
    const result = runInNewContext('let PRIMARY_SCALE=0,FORCED_SCALE=0; const DPI_PROBE=false,FORCE_DSF=undefined;\n' + block + '\n({primary:PRIMARY_SCALE,forced:FORCED_SCALE});', {
      shouldLinearize: () => true, process: { platform: 'win32' }, console: { error() {} },
      readCachedPrimaryScale: () => { if (failure) throw Error('denied'); return 1.5; }, probePrimaryScale: () => 2,
      resolveForcedScale: () => 1, app: { commandLine: { appendSwitch() { switches++; } } },
    });
    assert.equal(result.primary, failure ? 0 : 1.5); assert.equal(result.forced, failure ? 0 : 1); assert.equal(switches, failure ? 0 : 1);
  }
});
