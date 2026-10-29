'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createController, NoticeHistory, notificationDecision, nativeErrorCode, threadUrl, noticeUrl, createNoticeRequest, isOwnedShortcut, ensureShortcut, APP_USER_MODEL_ID } = require('./codex-notifications.cjs');

const THREAD = '00000000-0000-4000-8000-000000000001';
const notice = (id = 'one') => ({ id, kind: 'completed', title: '任务完成', body: '可以查看结果', threadId: THREAD });

test('通知改名保留AUMID，仅接受本安装的新旧启动参数', () => {
  assert.equal(APP_USER_MODEL_ID, 'com.wanggong.codex-bluefish');
  const target = 'C:\\Windows\\System32\\wscript.exe';
  const args = ['"C:\\Pet\\启动龙娘桌宠.vbs"', '"C:\\Pet\\启动大肥鱼.vbs"'];
  const own = { target, args: args[0], appUserModelId: APP_USER_MODEL_ID };
  assert.equal(isOwnedShortcut(own, target, args), true);
  assert.equal(isOwnedShortcut({ ...own, args: args[1] }, target, args), true);
  assert.equal(isOwnedShortcut({ ...own, target: target.toUpperCase() }, target, args), true);
  assert.equal(isOwnedShortcut({ ...own, args: '"C:\\OtherPet\\启动大肥鱼.vbs"' }, target, args), false);
  assert.equal(isOwnedShortcut({ ...own, appUserModelId: 'other.app' }, target, args), false);
  assert.equal(isOwnedShortcut({ ...own, target: 'C:\\Other\\wscript.exe' }, target, args), false);
});

function fixture(foreground, options = {}) {
  const app = new EventEmitter();
  app.isReady = () => false;
  app.whenReady = () => new Promise(() => {});
  const shown = [];
  const opened = [];
  const logs = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(value) { super(); this.value = value; }
    show() { shown.push(this); }
    close() { this.emit('close'); }
  }
  let checks = 0;
  const controller = createController({
    locale: options.locale || 'zh-CN',
    hostRequest: options.hostRequest || (async () => ({ status: 200, body: JSON.stringify({ notices: [notice()] }) })),
    checkForeground: async () => { checks += 1; if (foreground instanceof Error) throw foreground; return foreground; },
    electron: { app, Notification, shell: { openExternal: async (url) => { opened.push(url); } } },
    log: (value) => logs.push(value),
    activateNotice: options.activateNotice,
  });
  return { controller, app, shown, opened, logs, checks: () => checks };
}

test('foreground and failed checks suppress notifications; errors never disclose payload', async () => {
  for (const state of [{ ok: true, isCodexForeground: true }, new Error('sensitive payload'), { ok: false }]) {
    const f = fixture(state);
    await f.controller.poll();
    await f.controller.poll();
    assert.equal(f.shown.length, 0);
    assert.equal(f.checks(), 1);
    assert.ok(f.logs.every((entry) => !entry.includes('sensitive payload')));
    f.controller.stop();
  }
  assert.equal(notificationDecision(null), 'error');
});

test('English通知诊断不翻译通知正文，也不泄漏原生错误正文', async () => {
  const f = fixture({ ok: true, isCodexForeground: false, protocolRegistered: true }, { locale: 'en' });
  await f.controller.poll();
  assert.equal(f.shown[0].value.title, '任务完成'); assert.equal(f.shown[0].value.body, '可以查看结果');
  f.shown[0].emit('failed', {}, 'HRESULT: -2147023728 PRIVATE_BODY');
  assert.ok(f.logs.some(line => /Could not display.*0x80070490/.test(line)));
  assert.ok(f.logs.every(line => !line.includes('PRIVATE_BODY'))); f.controller.stop();
});

function shortcutFixture() {
  const directory = path.join(path.resolve('fakeAppData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const launcher = path.resolve('fakePet', 'Start Codex Pet.vbs');
  const target = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  const links = new Map(), commands = [], logs = [];
  const owned = name => ({ target, args: '"' + path.join(path.dirname(launcher), name) + '"', appUserModelId: APP_USER_MODEL_ID });
  const electron = { app: { getPath: () => path.resolve('fakeAppData') }, shell: {
    readShortcutLink: name => links.get(name),
    writeShortcutLink: (name, _mode, value) => { links.set(name, value); return true; },
  } };
  const deps = { platform: 'win32', locale: 'en', execFileSyncImpl: (_file, args) => commands.push(args), fsImpl: {
    existsSync: name => name === launcher || links.has(name), mkdirSync() {},
    copyFileSync: (from, to) => { if (links.has(to)) throw new Error('already exists'); links.set(to, { ...links.get(from) }); },
    unlinkSync: name => links.delete(name),
  } };
  return { directory, launcher, target, links, commands, logs, owned, deps, electron, run: () => ensureShortcut(electron, launcher, value => logs.push(value), deps) };
}

test('Codex Pet快捷方式迁移两种旧名，仅删除同安装参数/AUMID/目标均匹配的项', () => {
  const f = shortcutFixture(); const dragon = path.join(f.directory, '龙娘桌宠.lnk'), fish = path.join(f.directory, 'Codex 大肥鱼桌宠.lnk');
  f.links.set(dragon, f.owned('启动龙娘桌宠.vbs')); f.links.set(fish, f.owned('启动大肥鱼.vbs')); f.run();
  const current = f.links.get(path.join(f.directory, 'Codex Pet.lnk'));
  assert.equal(current.description, 'Codex Pet'); assert.equal(current.appUserModelId, APP_USER_MODEL_ID);
  assert.equal(current.args, '"' + f.launcher + '"'); assert.equal(f.links.has(dragon), false); assert.equal(f.links.has(fish), false);
  assert.ok(f.commands.some(args => args.includes('DisplayName') && args.includes('Codex Pet')));
});

test('同名新快捷方式不属于本项目时不改动；外部目录旧快捷方式不迁移不删除', () => {
  const blocked = shortcutFixture(); const current = path.join(blocked.directory, 'Codex Pet.lnk');
  const foreign = { ...blocked.owned('Start Codex Pet.vbs'), appUserModelId: 'another.app' }; blocked.links.set(current, foreign); blocked.run();
  assert.equal(blocked.links.get(current), foreign); assert.equal(blocked.commands.length, 0);
  const safe = shortcutFixture(); const old = path.join(safe.directory, '龙娘桌宠.lnk');
  const otherDirectory = { ...safe.owned('启动龙娘桌宠.vbs'), args: '"' + path.resolve('otherPet', '启动龙娘桌宠.vbs') + '"' };
  safe.links.set(old, otherDirectory); safe.run(); assert.equal(safe.links.get(old), otherDirectory); assert.ok(safe.links.has(path.join(safe.directory, 'Codex Pet.lnk')));
});

test('安装通知入口使用Codex Pet显示名，但AUMID继续兼容原通知身份', () => {
  const names = [], identities = []; const app = new EventEmitter(); app.setName = name => names.push(name); app.setAppUserModelId = id => identities.push(id); app.isReady = () => false; app.whenReady = () => new Promise(() => {});
  const box = { module: { exports: {} }, require: name => name === 'electron' ? { app, Notification: {}, shell: {} } : require(name), process: { platform: 'win32', env: {} }, __dirname, URL, AbortSignal, setInterval, clearInterval, console };
  vm.runInNewContext(readFileSync(path.join(__dirname, 'codex-notifications.cjs'), 'utf8'), box);
  const controller = box.module.exports.install({}); assert.deepEqual(names, ['Codex Pet']); assert.deepEqual(identities, ['com.wanggong.codex-bluefish']); controller.stop();
});

test('改名时新名称发生竞态冲突，保留可用旧入口，不覆盖或删除外部快捷方式', () => {
  const f = shortcutFixture(), old = path.join(f.directory, '龙娘桌宠.lnk'), current = path.join(f.directory, 'Codex Pet.lnk');
  f.links.set(old, f.owned('启动龙娘桌宠.vbs'));
  const foreign = { target: 'other.exe', args: '', appUserModelId: 'other.app' };
  f.deps.fsImpl.copyFileSync = () => { f.links.set(current, foreign); throw new Error('COPYFILE_EXCL conflict'); };
  f.run(); assert.equal(f.links.get(current), foreign); assert.ok(f.links.has(old));
  assert.equal(f.links.get(old).args, '"' + f.launcher + '"'); assert.ok(f.logs.some(line => /Could not create/.test(line)));
});

test('background sends once, validates thread UUID and opens only a registered Codex protocol', async () => {
  const f = fixture({ ok: true, isCodexForeground: false, protocolRegistered: true });
  await f.controller.poll();
  await f.controller.poll();
  assert.equal(f.shown.length, 1);
  f.shown[0].emit('click');
  await new Promise(setImmediate);
  assert.deepEqual(f.opened, [`codex://threads/${THREAD}`]);
  assert.equal(threadUrl({ threadId: null }, true), null);
  assert.equal(threadUrl({ threadId: '../other' }, true), null);
  assert.equal(threadUrl(notice(), false), null);
  f.controller.stop();
});

test('unregistered protocol keeps toast without attempting an external open', async () => {
  const f = fixture({ ok: true, isCodexForeground: false, protocolRegistered: false });
  await f.controller.poll();
  f.shown[0].emit('click');
  await new Promise(setImmediate);
  assert.equal(f.shown.length, 1);
  assert.deepEqual(f.opened, []);
  f.controller.stop();
});

test('宿主激活接缝优先于Codex深链，既有默认跳转保持原样', async () => {
  const calls = [];
  const f = fixture({ ok: true, isCodexForeground: false, protocolRegistered: true }, { activateNotice: async (value, foreground) => { calls.push({ value, foreground }); } });
  await f.controller.poll(); f.shown[0].emit('click'); await new Promise(setImmediate);
  assert.equal(calls.length, 1); assert.equal(calls[0].value.id, 'one'); assert.equal(calls[0].foreground.protocolRegistered, true); assert.deepEqual(f.opened, []); f.controller.stop();
});

test('polls do not overlap and shutdown ignores a pending response', async () => {
  let release;
  let calls = 0;
  const f = fixture({ ok: true, isCodexForeground: false }, {
    hostRequest: () => { calls += 1; return new Promise((resolve) => { release = resolve; }); },
  });
  const first = f.controller.poll();
  await f.controller.poll();
  assert.equal(calls, 1);
  f.app.emit('before-quit');
  release({ status: 200, body: JSON.stringify({ notices: [notice()] }) });
  await first;
  await f.controller.poll();
  assert.equal(f.shown.length, 0);
  assert.equal(calls, 1);
});

test('history rejects malformed data and stays bounded', () => {
  const history = new NoticeHistory(2);
  assert.equal(history.take([notice('a'), notice('a'), { id: 'bad' }]).length, 1);
  history.take([notice('b'), notice('c')]);
  assert.equal(history.ids.size, 2);
  assert.deepEqual([...history.ids], ['b', 'c']);
});

test('HTTP notice endpoint is fixed to loopback and never follows a redirect', async () => {
  const safe = 'http://127.0.0.1:3180/dsh-pet-7340/codex-notices';
  assert.equal(noticeUrl(safe), safe);
  for (const value of [
    'https://127.0.0.1:3180/dsh-pet-7340/codex-notices',
    'http://example.com:3180/dsh-pet-7340/codex-notices',
    'http://user:secret@127.0.0.1:3180/dsh-pet-7340/codex-notices',
    safe + '?secret=anything', safe + '#fragment', safe.replace('codex-notices', 'config'),
  ]) assert.equal(noticeUrl(value), null);
  const request = createNoticeRequest(safe, async (url, options) => {
    assert.equal(url, safe);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return { status: 200, text: async () => '{"notices":[]}' };
  });
  assert.deepEqual(await request(), { status: 200, body: '{"notices":[]}' });
  await assert.rejects(createNoticeRequest('bad'), /notice-endpoint-invalid/);
});

test('native diagnostics retain only HRESULT and never notification content', async () => {
  assert.equal(nativeErrorCode('WinAPI: Show failed, ERROR (HRESULT: -2147023728) secret title'), 'HRESULT=0x80070490');
  assert.equal(nativeErrorCode(new Error('HRESULT=0x80040154 private body')), 'HRESULT=0x80040154');
  assert.equal(nativeErrorCode('sensitive title, user value 0x12345678'), 'HRESULT=unavailable');
  const f = fixture({ ok: true, isCodexForeground: false, protocolRegistered: true });
  await f.controller.poll();
  f.shown[0].emit('failed', {}, 'WinAPI: Show failed, ERROR (HRESULT: -2147023728) sensitive title');
  assert.ok(f.logs.some((entry) => entry.includes('0x80070490')));
  assert.ok(f.logs.every((entry) => !entry.includes('sensitive title')));
  f.controller.stop();
});
