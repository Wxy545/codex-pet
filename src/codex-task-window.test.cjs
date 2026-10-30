'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createController, installPreload, sanitizeSnapshot, CHANNELS } = require('./codex-task-window.cjs');
const L = require('./codex-locale.cjs');
L.setLocale('zh-CN');

const ID = '00000000-0000-4000-8000-000000000001';
const directory = path.resolve('test-task-directory');
const otherDirectory = path.resolve('other-test-task-directory');

function fixture(options = {}) {
  const handlers = new Map();
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, callback) => handlers.set(channel, callback);
  ipcMain.removeHandler = channel => handlers.delete(channel);
  const windows = [];
  const app = new EventEmitter();
  app.whenReady = async () => {};
  const pet = new EventEmitter();
  pet.mainFrame = {};
  pet.getURL = () => pathToFileURL(path.join(__dirname, 'index.html')).href + '?petIndex=0';
  class BrowserWindow extends EventEmitter {
    static fromWebContents(contents) { return contents === pet ? { webContents: pet } : windows.find(win => win.webContents === contents); }
    constructor(settings) {
      super(); this.settings = settings; this.destroyed = false; this.showCount = 0; this.focusCount = 0;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.getURL = () => this.url;
      this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; };
      windows.push(this);
    }
    setMenu(value) { this.menu = value; }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    show() { this.showCount++; }
    focus() { this.focusCount++; }
    async loadFile(file) { this.url = pathToFileURL(file).href; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const copied = [];
  const calls = [];
  let nextDialog = { canceled: false, filePaths: [directory] };
  let canonical = directory;
  let view = { state: 'idle', progress: [], summary: '' };
  const controller = createController({
    electron: { app, BrowserWindow, ipcMain, dialog: { showOpenDialog: async () => nextDialog }, clipboard: { writeText: text => copied.push(text) } },
    fsImpl: { realpath: async () => canonical, stat: async () => ({ isDirectory: () => true }), ...options.fsImpl },
    canUse: options.canUse,
    hostRequest: async (method, route, body) => {
      calls.push({ method, route, body });
      if (options.hostRequest) return options.hostRequest(method, route, body);
      if (method === 'POST' && route.endsWith('/cancel')) view = { ...view, state: 'cancelling' };
      else if (method === 'POST') view = { id: ID, state: 'running', cwd: directory, permission: JSON.parse(body).permission, progress: [], summary: '' };
      return { status: method === 'POST' ? 202 : 200, body: JSON.stringify(view) };
    },
  });
  const panelEvent = () => ({ sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame });
  const invoke = (channel, body, event = panelEvent()) => handlers.get(channel)(event, body);
  return { controller, windows, handlers, ipcMain, app, copied, calls, invoke, pet,
    setDialog: value => { nextDialog = value; }, setCanonical: value => { canonical = value; }, setView: value => { view = value; } };
}

test('原生移交发生在目录复核期间时，不启动旧面板的新Codex任务', async t => {
  let allowed=true,release,blocking=false;
  const f=fixture({canUse:()=>allowed,fsImpl:{stat:async()=>{if(blocking)await new Promise(resolve=>{release=resolve;});return{isDirectory:()=>true};}}});t.after(()=>f.controller.dispose());
  await f.controller.open();await f.invoke(CHANNELS.directory);blocking=true;
  const pending=f.invoke(CHANNELS.submit,{cwd:directory,task:'synthetic task',permission:'read-only',confirmed:true});await new Promise(setImmediate);
  allowed=false;release();assert.equal((await pending).ok,false);assert.equal(f.calls.length,0);
});

test('面板单实例并隔离Node权限，阻止任意导航与新窗口', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  await f.controller.open(); await f.controller.open();
  assert.equal(f.windows.length, 1);
  const win = f.windows[0];
  assert.equal(win.settings.webPreferences.nodeIntegration, false);
  assert.equal(win.settings.webPreferences.contextIsolation, true);
  assert.equal(win.settings.webPreferences.sandbox, true);
  assert.equal(win.settings.title, 'Codex Pet · 操作任务');
  assert.deepEqual(win.openHandler({ url: 'https://example.com' }), { action: 'deny' });
  let prevented = 0;
  win.webContents.emit('will-navigate', { preventDefault: () => { prevented++; } }, 'https://example.com');
  assert.equal(prevented, 1);
  win.destroy();
  assert.equal(f.calls.length, 0, '关窗口不能隐式取消任务');
  await f.controller.open(); assert.equal(f.windows.length, 2);
});

test('任务IPC只接受面板主frame，其他页面和iframe不能读取或执行任务', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.open();
  const foreign = { sender: f.pet, senderFrame: f.pet.mainFrame };
  for (const channel of [CHANNELS.state, CHANNELS.directory, CHANNELS.submit, CHANNELS.cancel, CHANNELS.copy]) {
    assert.equal((await f.invoke(channel, {}, foreign)).code, 'unauthorized');
  }
  const contents = f.windows[0].webContents;
  assert.equal((await f.invoke(CHANNELS.state, undefined, { sender: contents, senderFrame: {} })).code, 'unauthorized');
  assert.equal(f.calls.length, 0);
});

test('仅拥有的宠物页面可以打开面板，打开能力不暴露任务执行', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  f.ipcMain.emit(CHANNELS.open, { sender: { getURL: () => 'https://example.com', mainFrame: null } });
  await Promise.resolve(); assert.equal(f.windows.length, 0);
  f.ipcMain.emit(CHANNELS.open, { sender: f.pet, senderFrame: f.pet.mainFrame });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.windows.length, 1);
  const exposed = [];
  const sent = [];
  installPreload({ contextBridge: { exposeInMainWorld: (name, value) => exposed.push({ name, value }) }, ipcRenderer: { send: (...args) => sent.push(args) } });
  assert.equal(exposed[0].name, 'codexTaskPanel');
  assert.deepEqual(Object.keys(exposed[0].value), ['open']);
  exposed[0].value.open('ignored-command');
  assert.deepEqual(sent, [[CHANNELS.open]]);
});

test('提交必须使用原生已选目录、确认和有限权限，不能注入其他工作目录', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.open();
  const body = { cwd: directory, task: ' 检查项目 ', permission: 'read-only', confirmed: true };
  assert.equal((await f.invoke(CHANNELS.submit, body)).code, 'directory_required');
  assert.equal((await f.invoke(CHANNELS.directory)).directory, directory);
  assert.equal((await f.invoke(CHANNELS.submit, { ...body, confirmed: false })).code, 'confirmation_required');
  assert.equal((await f.invoke(CHANNELS.submit, { ...body, cwd: otherDirectory })).code, 'invalid_cwd');
  assert.equal((await f.invoke(CHANNELS.submit, { ...body, permission: 'danger-full-access' })).code, 'invalid_input');
  assert.equal(f.calls.length, 0);
  const accepted = await f.invoke(CHANNELS.submit, { ...body, ignored: 'untrusted option' });
  assert.equal(accepted.ok, true); assert.equal(accepted.snapshot.state, 'running');
  assert.deepEqual(JSON.parse(f.calls[0].body), { cwd: directory, task: '检查项目', permission: 'read-only', confirmed: true });
});

test('已选目录解析到另一目标时必须重选，取消文件夹选择保留已有范围', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.open();
  await f.invoke(CHANNELS.directory);
  f.setDialog({ canceled: true, filePaths: [] });
  assert.deepEqual(await f.invoke(CHANNELS.directory), { ok: true, cancelled: true, directory });
  f.setCanonical(otherDirectory);
  assert.equal((await f.invoke(CHANNELS.submit, { cwd: directory, task: '检查', permission: 'workspace-write', confirmed: true })).code, 'invalid_cwd');
  assert.equal(f.calls.length, 0);
});

test('提交等待期间拒绝重复确认，不产生第二次宿主请求', async t => {
  let resolveRequest;
  const pending = new Promise(resolve => { resolveRequest = resolve; });
  const f = fixture({ hostRequest: () => pending }); t.after(() => f.controller.dispose());
  await f.controller.open(); await f.invoke(CHANNELS.directory);
  const body = { cwd: directory, task: '检查', permission: 'read-only', confirmed: true };
  const first = f.invoke(CHANNELS.submit, body);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.invoke(CHANNELS.submit, body)).code, 'busy');
  assert.equal(f.calls.length, 1);
  resolveRequest({ status: 202, body: JSON.stringify({ id: ID, state: 'running', progress: [], summary: '' }) });
  assert.equal((await first).ok, true);
});

test('目录A提交挂起stat时，不能并发改选B或把POST工作目录替换为B', async t => {
  let releaseStat;
  let reachedStat;
  let holdStat = false;
  const statReached = new Promise(resolve => { reachedStat = resolve; });
  const statWait = new Promise(resolve => { releaseStat = resolve; });
  const f = fixture({ fsImpl: { stat: async target => {
    if (holdStat && target === directory) { holdStat = false; reachedStat(); await statWait; }
    return { isDirectory: () => true };
  } } });
  t.after(() => f.controller.dispose()); await f.controller.open();
  await f.invoke(CHANNELS.directory);
  holdStat = true;
  const first = f.invoke(CHANNELS.submit, { cwd: directory, task: '检查A', permission: 'workspace-write', confirmed: true });
  await statReached;
  f.setCanonical(otherDirectory);
  f.setDialog({ canceled: false, filePaths: [otherDirectory] });
  assert.equal((await f.invoke(CHANNELS.directory)).code, 'busy');
  releaseStat();
  assert.equal((await first).ok, true);
  assert.equal(JSON.parse(f.calls.find(call => call.method === 'POST').body).cwd, directory);
});

test('提交前已打开的改目录对话框晚返回时，不能改动提交中的目录快照', async t => {
  let releaseStat;
  let reachedStat;
  let releaseDialog;
  let holdStat = false;
  const statReached = new Promise(resolve => { reachedStat = resolve; });
  const statWait = new Promise(resolve => { releaseStat = resolve; });
  const dialogWait = new Promise(resolve => { releaseDialog = resolve; });
  const f = fixture({ fsImpl: { stat: async target => {
    if (holdStat && target === directory) { holdStat = false; reachedStat(); await statWait; }
    return { isDirectory: () => true };
  } } });
  t.after(() => f.controller.dispose()); await f.controller.open();
  await f.invoke(CHANNELS.directory);
  f.setDialog(dialogWait);
  const chooser = f.invoke(CHANNELS.directory);
  holdStat = true;
  const submission = f.invoke(CHANNELS.submit, { cwd: directory, task: '检查A', permission: 'read-only', confirmed: true });
  await statReached;
  f.setCanonical(otherDirectory);
  releaseDialog({ canceled: false, filePaths: [otherDirectory] });
  assert.equal((await chooser).code, 'busy');
  releaseStat();
  assert.equal((await submission).ok, true);
  assert.equal(JSON.parse(f.calls.find(call => call.method === 'POST').body).cwd, directory);
});

test('取消只接受当前任务ID，复制只取服务最终摘要', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.open();
  f.setView({ id: ID, state: 'running', progress: [], summary: '' });
  assert.equal((await f.invoke(CHANNELS.cancel, 'another-task')).code, 'stale_task');
  assert.equal(f.calls.some(call => call.route.endsWith('/cancel')), false);
  assert.equal((await f.invoke(CHANNELS.cancel, ID)).snapshot.state, 'cancelling');
  assert.equal(JSON.parse(f.calls.find(call => call.route.endsWith('/cancel')).body).id, ID);
  assert.equal((await f.invoke(CHANNELS.copy)).code, 'empty_result');
  f.setView({ id: ID, state: 'completed', progress: [], summary: '已完成检查。' });
  assert.equal((await f.invoke(CHANNELS.copy, '不应复制的文本')).ok, true);
  assert.deepEqual(f.copied, ['已完成检查。']);
});

test('状态仅保留固定进度和受限摘要，异常不传出原始正文或stderr', async t => {
  const view = sanitizeSnapshot({ id: ID, state: 'failed', cwd: directory, permission: 'workspace-write',
    progress: [{ kind: 'working', text: 'secret command' }, { kind: 'analysis', text: 'secret reasoning' }],
    summary: 'x'.repeat(70000), error: { code: 'process_failed', message: 'secret stderr' }, raw: 'secret' });
  assert.equal(view.summary.length, 64000);
  assert.equal(view.progress.length, 1);
  assert.equal(JSON.stringify(view).includes('secret'), false);
  assert.equal(sanitizeSnapshot({ state: 'unknown' }), null);
  const inheritedKeys = sanitizeSnapshot({ state: 'failed', progress: [{ kind: '__proto__', text: 'secret' }], error: { code: 'constructor' } });
  assert.deepEqual(inheritedKeys.progress, []);
  assert.equal(inheritedKeys.error, undefined);
  const f = fixture({ hostRequest: async () => { throw new Error('private exception'); } });
  t.after(() => f.controller.dispose()); await f.controller.open();
  const failed = await f.invoke(CHANNELS.state);
  assert.equal(failed.code, 'host_unavailable');
  assert.equal(JSON.stringify(failed).includes('private exception'), false);
});

test('释放面板移除自己的IPC与窗口，不触发宿主取消', async () => {
  const f = fixture(); await f.controller.open();
  f.controller.dispose(); f.controller.dispose();
  assert.equal(f.handlers.size, 0);
  assert.equal(f.ipcMain.listenerCount(CHANNELS.open), 0);
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.calls.length, 0);
});
