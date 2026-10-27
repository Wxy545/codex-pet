import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { locateCodex } from '../src/codex-path.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'codex-path-'));
  t.after(() => {
    // 清理范围只限本测试刚创建的临时目录。
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('codex-path-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = (...parts) => {
    const target = join(root, ...parts);
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, 'test executable');
    fs.chmodSync(target, 0o755);
    return target;
  };
  const install = (version, modified) => {
    const executable = file('OpenAI', 'Codex', 'bin', version, 'codex.exe');
    fs.utimesSync(dirname(executable), modified, modified);
    return executable;
  };
  return { root, file, install };
}

function absentCommand() { throw new Error('private command error'); }

test('explicit executable has priority and returns its absolute real path without a command', t => {
  const f = fixture(t);
  const explicit = f.file('custom cli', 'codex.exe');
  assert.equal(locateCodex({ env: { CODEX_PET_CLI: explicit, LOCALAPPDATA: f.root }, platform: 'win32',
    execFileSyncImpl() { assert.fail('explicit configuration must not run a locator'); } }), fs.realpathSync(explicit));
});

test('invalid explicit configuration fails clearly and never silently falls back', t => {
  const f = fixture(t);
  f.install('valid-build', new Date());
  const directory = join(f.root, 'directory.exe'); fs.mkdirSync(directory);
  for (const explicit of ['', 'codex.exe', join(f.root, 'missing.exe'), f.file('codex.cmd'), f.file('codex'), directory]) {
    assert.throws(() => locateCodex({ env: { CODEX_PET_CLI: explicit, LOCALAPPDATA: f.root }, platform: 'win32',
      execFileSyncImpl() { assert.fail('invalid explicit configuration must stop resolution'); } }),
    error => /CODEX_PET_CLI/.test(error.message) && !error.message.includes(f.root));
  }
});

test('where.exe requests codex.exe without a shell and skips shims, missing files and directories', t => {
  const f = fixture(t);
  const executable = f.file('Codex App', 'codex.exe');
  const directory = join(f.root, 'folder.exe'); fs.mkdirSync(directory);
  const output = [f.file('npm', 'codex.cmd'), f.file('npm', 'codex'), join(f.root, 'gone.exe'), directory, executable].join('\r\n');
  const calls = [];
  assert.equal(locateCodex({ env: {}, platform: 'win32', execFileSyncImpl(...args) { calls.push(args); return output; } }),
    fs.realpathSync(executable));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'where.exe');
  assert.deepEqual(calls[0][1], ['codex.exe']);
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].windowsHide, true);
  assert.equal(calls[0][2].encoding, 'utf8');
});

test('where.exe executable wins before desktop installation fallback', t => {
  const f = fixture(t);
  const onPath = f.file('PATH', 'codex.exe'); f.install('latest', new Date());
  assert.equal(locateCodex({ env: { LOCALAPPDATA: f.root }, platform: 'win32', execFileSyncImpl: () => onPath }), fs.realpathSync(onPath));
});

test('desktop fallback chooses the newest valid version by directory mtime, not directory name', t => {
  const f = fixture(t);
  f.install('zzz-old', new Date('2025-01-01'));
  const newest = f.install('aaa-new', new Date('2026-01-01'));
  assert.equal(locateCodex({ env: { LOCALAPPDATA: f.root }, platform: 'win32', execFileSyncImpl: absentCommand }), fs.realpathSync(newest));
});

test('desktop fallback skips incomplete, deleted and non-directory versions', t => {
  const f = fixture(t);
  const valid = f.install('old-valid', new Date('2025-01-01'));
  const missing = f.install('new-missing', new Date('2026-01-01')); fs.unlinkSync(missing);
  fs.mkdirSync(join(f.root, 'OpenAI', 'Codex', 'bin', 'new-empty'));
  f.file('OpenAI', 'Codex', 'bin', 'not-a-directory');
  assert.equal(locateCodex({ env: { LOCALAPPDATA: f.root }, platform: 'win32', execFileSyncImpl: () => `${f.file('npm', 'codex.cmd')}\n${join(f.root, 'gone.exe')}` }), fs.realpathSync(valid));
});

test('an executable disappearing during validation does not prevent another valid version', t => {
  const f = fixture(t);
  const older = f.install('older', new Date('2025-01-01'));
  const vanishing = f.install('newer', new Date('2026-01-01'));
  assert.equal(locateCodex({ env: { LOCALAPPDATA: f.root }, platform: 'win32', execFileSyncImpl: absentCommand,
    fsImpl: { realpathSync(path) { if (path === vanishing) throw new Error('private deleted file'); return fs.realpathSync(path); } } }), fs.realpathSync(older));
});

test('a version directory disappearing while enumerating is safely skipped', t => {
  const f = fixture(t);
  const older = f.install('older', new Date('2025-01-01'));
  const vanishedDirectory = dirname(f.install('newer', new Date('2026-01-01')));
  assert.equal(locateCodex({ env: { LOCALAPPDATA: f.root }, platform: 'win32', execFileSyncImpl: absentCommand,
    fsImpl: { statSync(path) { if (path === vanishedDirectory) throw new Error('private vanished directory'); return fs.statSync(path); } } }), fs.realpathSync(older));
});

test('equal mtimes use a stable directory-name ordering', t => {
  const f = fixture(t); const time = new Date('2026-01-01');
  f.install('build-001', time); const chosen = f.install('build-002', time);
  assert.equal(locateCodex({ env: { LOCALAPPDATA: f.root }, platform: 'win32', execFileSyncImpl: absentCommand }), fs.realpathSync(chosen));
});

test('missing LOCALAPPDATA, missing bin and empty bin fail with a fixed non-personal error', t => {
  const f = fixture(t);
  const environments = [{}, { LOCALAPPDATA: f.root }, { LOCALAPPDATA: join(f.root, 'missing') }];
  fs.mkdirSync(join(f.root, 'OpenAI', 'Codex', 'bin'), { recursive: true });
  for (const env of environments) {
    assert.throws(() => locateCodex({ env, platform: 'win32', execFileSyncImpl: absentCommand }), error =>
      /未找到.*Codex CLI/.test(error.message) && !/private/.test(error.message) && !error.message.includes(f.root));
  }
});

test('unreadable fallback does not expose filesystem details', () => {
  assert.throws(() => locateCodex({ env: { LOCALAPPDATA: 'C:\\private-user' }, platform: 'win32', execFileSyncImpl: absentCommand,
    fsImpl: { readdirSync() { throw new Error('SECRET private filesystem details'); } } }), error =>
    /未找到.*Codex CLI/.test(error.message) && !/SECRET|private/.test(error.message));
});

test('non-Windows uses which codex without a shell and accepts an executable without extension', t => {
  const f = fixture(t); const executable = f.file('bin', 'codex');
  assert.equal(locateCodex({ env: {}, platform: 'linux', execFileSyncImpl(command, args, options) {
    assert.equal(command, 'which'); assert.deepEqual(args, ['codex']); assert.equal(options.shell, false);
    return executable + '\n';
  } }), fs.realpathSync(executable));
});

test('non-Windows explicit path is also validated before command lookup', t => {
  const f = fixture(t); const executable = f.file('bin', 'codex');
  assert.equal(locateCodex({ env: { CODEX_PET_CLI: executable }, platform: 'linux', execFileSyncImpl: absentCommand }), fs.realpathSync(executable));
});
