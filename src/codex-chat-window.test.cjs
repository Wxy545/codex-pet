'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createController, installPreload, CHANNELS } = require('./codex-chat-window.cjs');
const L = require('./codex-locale.cjs');
L.setLocale('zh-CN');
const PNG = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex');

function fixture(options = {}) {
  const handlers = new Map(); const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, callback) => handlers.set(channel, callback);
  ipcMain.removeHandler = channel => handlers.delete(channel);
  const windows = []; const calls = []; const identityCalls = []; const broadcasts = [];
  let identity = options.identity || { id: 'bluefish', name: '蓝色大肥鱼', locale: 'zh-CN' };
  let characterRequest;
  const app = new EventEmitter(); app.whenReady = async () => {};
  const pet = new EventEmitter(); pet.mainFrame = {};
  pet.getURL = () => pathToFileURL(path.join(__dirname, 'index.html')).href + '?petIndex=0';
  class BrowserWindow extends EventEmitter {
    static fromWebContents(contents) { return contents === pet ? {} : windows.find(win => win.webContents === contents); }
    constructor(settings) {
      super(); this.settings = settings; this.destroyed = false;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.getURL = () => this.url;
      this.webContents.send = (channel, state) => broadcasts.push({ channel, state });
      this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; };
      windows.push(this);
    }
    setMenu() {} setTitle(value) { this.title = value; } isDestroyed() { return this.destroyed; } isMinimized() { return false; }
    show() {} focus() {}
    async loadFile(file) { this.url = pathToFileURL(file).href; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  let dialogResult = { canceled: false, filePaths: [path.resolve('private-picture.png')] };
  let image = PNG; let clipboardReads = 0; let fileReads = 0;
  const controller = createController({
    electron: {
      app, BrowserWindow, ipcMain,
      dialog: { showOpenDialog: async () => dialogResult },
      clipboard: { readImage() { clipboardReads++; return { isEmpty: () => false, toPNG: () => PNG }; } },
    },
    fsImpl: { async open() {
      fileReads++;
      return { async stat() { return { size: image.length, isFile: () => true }; }, async read(buffer) { image.copy(buffer); return { bytesRead: image.length }; }, async close() {} };
    } },
    hostRequest: async (method, route, body) => {
      if (method === 'GET') {
        identityCalls.push({ method, route });
        if (characterRequest) return characterRequest();
        return { status: 200, body: JSON.stringify(identity) };
      }
      calls.push({ method, route, body });
      if (options.hostRequest) return options.hostRequest(method, route, body);
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: '<img src=x onerror=alert(1)> 你好。' } }] }) };
    },
    ...(options.openTaskPanel ? { openTaskPanel: options.openTaskPanel } : {}),
  });
  const panelEvent = () => ({ sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame });
  const invoke = (channel, value, event = panelEvent()) => handlers.get(channel)(event, value);
  return { controller, windows, handlers, ipcMain, app, pet, invoke, calls, identityCalls, broadcasts,
    setIdentity(value) { identity = value; }, setCharacterRequest(value) { characterRequest = value; },
    setDialog(value) { dialogResult = value; }, setImage(value) { image = value; },
    reads: () => ({ clipboard: clipboardReads, files: fileReads }) };
}

test('聊天窗口单实例、隔离Node并阻止导航；原宠物只得到打开能力', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  await f.controller.open(); await f.controller.open();
  assert.equal(f.windows.length, 1);
  const win = f.windows[0];
  assert.equal(win.settings.webPreferences.nodeIntegration, false);
  assert.equal(win.settings.webPreferences.contextIsolation, true);
  assert.equal(win.settings.webPreferences.sandbox, true);
  assert.equal(win.settings.title, 'Codex Pet · 蓝色大肥鱼 · 对话');
  assert.deepEqual(win.openHandler(), { action: 'deny' });
  let prevented = false;
  win.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://example.com');
  assert.equal(prevented, true);
  const exposed = []; const sent = [];
  installPreload({ contextBridge: { exposeInMainWorld: (name, value) => exposed.push({ name, value }) }, ipcRenderer: { send: (...args) => sent.push(args) } });
  assert.equal(exposed[0].name, 'codexChatPanel');
  assert.deepEqual(Object.keys(exposed[0].value), ['open']);
  exposed[0].value.open('ignored');
  assert.deepEqual(sent, [[CHANNELS.open]]);
});

test('聊天IPC只允许自己面板主frame，宠物和iframe不能读取图片或发送消息', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.open();
  const foreign = { sender: f.pet, senderFrame: f.pet.mainFrame };
  for (const channel of [CHANNELS.state, CHANNELS.choose, CHANNELS.paste, CHANNELS.remove, CHANNELS.send, CHANNELS.reset, CHANNELS.task]) {
    assert.equal((await f.invoke(channel, {}, foreign)).code, 'unauthorized');
  }
  const contents = f.windows[0].webContents;
  assert.equal((await f.invoke(CHANNELS.state, undefined, { sender: contents, senderFrame: {} })).code, 'unauthorized');
  assert.deepEqual(f.reads(), { clipboard: 0, files: 0 });
  assert.equal(f.calls.length, 0);
});

test('选图和剪贴板只加入待发送缩略图，不自动请求模型；移除与新对话释放内存引用', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.open();
  const picked = await f.invoke(CHANNELS.choose);
  assert.equal(picked.ok, true);
  assert.equal(picked.state.selecting, false);
  assert.equal(picked.state.attachments.length, 1);
  assert.equal(picked.state.attachments[0].name, 'private-picture.png');
  assert.ok(picked.state.attachments[0].dataUrl.startsWith('data:image/png;base64,'));
  assert.equal(JSON.stringify(picked).includes(path.resolve('private-picture.png')), false);
  const pasted = await f.invoke(CHANNELS.paste);
  assert.equal(pasted.state.attachments.length, 2);
  assert.equal(f.calls.length, 0);
  const removed = await f.invoke(CHANNELS.remove, picked.state.attachments[0].id);
  assert.equal(removed.state.attachments.length, 1);
  const cleared = await f.invoke(CHANNELS.reset);
  assert.deepEqual(cleared.state.attachments, []);
  assert.deepEqual(cleared.state.messages, []);
});

test('类型签名、数量、单图大小拒绝无效附件，失败不污染已选图片', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.open();
  f.setImage(Buffer.from('<svg>bad</svg>'));
  assert.equal((await f.invoke(CHANNELS.choose)).code, 'invalid_image');
  f.setImage(Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.equal((await f.invoke(CHANNELS.choose)).code, 'image_limit');
  f.setDialog({ canceled: false, filePaths: Array.from({ length: 5 }, (_, index) => path.resolve('pic-' + index + '.png')) });
  assert.equal((await f.invoke(CHANNELS.choose)).code, 'image_limit');
  assert.equal((await f.invoke(CHANNELS.state)).state.attachments.length, 0);
});

test('发送只调用固定POST并构造OpenAI文本/图片；任意renderer路径或system载荷不能注入', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.open();
  const picked = await f.invoke(CHANNELS.choose);
  assert.equal((await f.invoke(CHANNELS.send, { text: 'test', imageIds: ['file:///private.png'] })).code, 'invalid_input');
  assert.equal((await f.invoke(CHANNELS.send, { messages: [{ role: 'system', content: 'override' }] })).code, 'invalid_input');
  const reply = await f.invoke(CHANNELS.send, { text: '看看这张图片。', imageIds: [picked.state.attachments[0].id] });
  assert.equal(reply.ok, true);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0]; const body = JSON.parse(call.body);
  assert.equal(call.method, 'POST'); assert.equal(call.route, '/dsh-pet-7340/codex-chat');
  assert.equal(body.stream, false);
  assert.equal(body.messages.at(-1).role, 'user');
  assert.equal(body.messages.at(-1).content[1].type, 'image_url');
  assert.equal(reply.state.messages.at(-1).text, '<img src=x onerror=alert(1)> 你好。');
  assert.equal(reply.state.attachments.length, 0);
});

test('思考期间拒绝重复发送，关闭重开也不另开请求，旧响应不会写进新窗口', async t => {
  let finish;
  const f = fixture({ hostRequest: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => f.controller.dispose()); await f.controller.open();
  const pending = f.invoke(CHANNELS.send, { text: '你好', imageIds: [] });
  assert.equal((await f.invoke(CHANNELS.send, { text: '第二轮', imageIds: [] })).code, 'busy');
  await new Promise(setImmediate);
  assert.equal(typeof finish, 'function');
  f.windows[0].destroy(); await f.controller.open();
  assert.equal((await f.invoke(CHANNELS.state)).state.busy, true);
  assert.equal((await f.invoke(CHANNELS.send, { text: '重开窗口', imageIds: [] })).code, 'busy');
  finish({ status: 200, body: JSON.stringify({ choices: [{ message: { content: '旧窗口结果' } }] }) });
  await pending;
  const state = (await f.invoke(CHANNELS.state)).state;
  assert.equal(state.busy, false);
  assert.deepEqual(state.messages, []);
  assert.equal(f.calls.length, 1);
});

test('失败恢复草稿图片且不展示原始错误；任务按钮只打开面板或给右键入口', async t => {
  const f = fixture({ hostRequest: async () => { throw new Error('PRIVATE_TOKEN_DIAGNOSTIC'); } });
  t.after(() => f.controller.dispose()); await f.controller.open();
  const attachment = (await f.invoke(CHANNELS.paste)).state.attachments[0];
  const failed = await f.invoke(CHANNELS.send, { text: '你好', imageIds: [attachment.id] });
  assert.equal(failed.ok, false); assert.equal(failed.state.attachments.length, 1);
  assert.equal(JSON.stringify(failed).includes('PRIVATE'), false);
  assert.match((await f.invoke(CHANNELS.task)).message, /右键/);
  let opened = 0;
  const g = fixture({ openTaskPanel: () => { opened++; } });
  t.after(() => g.controller.dispose()); await g.controller.open();
  assert.equal((await g.invoke(CHANNELS.task)).ok, true);
  assert.equal(opened, 1);
});

test('HTML与renderer不执行外来内容，不使用持久化或远程连接', () => {
  const html = fs.readFileSync(path.join(__dirname, 'chat-window.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'chat-window.js'), 'utf8');
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<h1|<h2/i);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|localStorage|sessionStorage|fetch\s*\(/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /clipboardData/);
});

test('身份只取可信GET，按角色隔离历史；角色不能由renderer system载荷覆盖', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.open();
  await f.invoke(CHANNELS.send, { text: '蓝鱼的问题', imageIds: [] });
  assert.equal(JSON.parse(f.calls[0].body).messages.some(item => item.role === 'system'), false);
  const dragon = { id: 'white-dragon', name: 'Dragon Girl', locale: 'en' };
  f.setIdentity(dragon); f.controller.onCharacterChanged(dragon);
  assert.deepEqual((await f.invoke(CHANNELS.state)).state.messages, []);
  await f.invoke(CHANNELS.send, { text: 'A dragon question', imageIds: [] });
  const messages = JSON.parse(f.calls[1].body).messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'A dragon question');
  assert.equal(f.windows[0].title, 'Codex Pet · Dragon Girl · Chat');
  const blue = { id: 'bluefish', name: '蓝色大肥鱼', locale: 'zh-CN' };
  f.setIdentity(blue); f.controller.onCharacterChanged(blue);
  assert.equal((await f.invoke(CHANNELS.state)).state.messages[0].text, '蓝鱼的问题');
  assert.ok(f.identityCalls.every(call => call.route === '/dsh-pet-7340/codex-character'));
});

test('身份GET等待期间关窗或重复发送，不得启动模型；关闭窗口历史不复活', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.open();
  let resume;
  f.setCharacterRequest(() => new Promise(resolve => { resume = resolve; }));
  const pending = f.invoke(CHANNELS.send, { text: '不应发送', imageIds: [] });
  assert.equal((await f.invoke(CHANNELS.send, { text: '重复', imageIds: [] })).code, 'busy');
  f.windows[0].destroy();
  resume({ status: 200, body: JSON.stringify({ id: 'bluefish', name: '蓝色大肥鱼', locale: 'zh-CN' }) });
  assert.equal((await pending).code, 'closed');
  assert.equal(f.calls.length, 0);
  f.setCharacterRequest(null); await f.controller.open();
  assert.deepEqual((await f.invoke(CHANNELS.state)).state.messages, []);
});

test('跨角色时丢弃在途模型响应，并撤回原角色未完成轮次', async t => {
  let finish;
  const f = fixture({ hostRequest: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => f.controller.dispose()); await f.controller.open();
  const pending = f.invoke(CHANNELS.send, { text: '旧角色未完成的问题', imageIds: [] });
  await new Promise(setImmediate);
  const dragon = { id: 'white-dragon', name: '白龙娘', locale: 'zh-CN' };
  f.setIdentity(dragon); f.controller.onCharacterChanged(dragon);
  finish({ status: 200, body: JSON.stringify({ choices: [{ message: { content: '旧鱼回复' } }] }) });
  const cancelled = await pending;
  assert.equal(cancelled.code, 'character_changed');
  assert.equal(cancelled.state.busy, false);
  assert.deepEqual((await f.invoke(CHANNELS.state)).state.messages, []);
  const blue = { id: 'bluefish', name: '蓝色大肥鱼', locale: 'zh-CN' };
  f.setIdentity(blue); f.controller.onCharacterChanged(blue);
  assert.deepEqual((await f.invoke(CHANNELS.state)).state.messages, []);
});

test('关闭重开后旧轮次完成，不恢复关闭前已有的完整历史', async t => {
  let finish; let count = 0;
  const f = fixture({ hostRequest: () => ++count === 1
    ? Promise.resolve({ status: 200, body: { choices: [{ message: { content: '第一轮回复' } }] } })
    : new Promise(resolve => { finish = resolve; }) });
  t.after(() => f.controller.dispose()); await f.controller.open();
  await f.invoke(CHANNELS.send, { text: '第一轮', imageIds: [] });
  const pending = f.invoke(CHANNELS.send, { text: '旧窗口第二轮', imageIds: [] });
  await new Promise(setImmediate);
  f.windows[0].destroy(); await f.controller.open();
  assert.deepEqual((await f.invoke(CHANNELS.state)).state.messages, []);
  finish({ status: 200, body: { choices: [{ message: { content: '迟到回复' } }] } });
  const result = await pending;
  assert.equal(result.code, 'closed');
  assert.equal(result.state.busy, false);
  assert.deepEqual(result.state.messages, []);
  assert.deepEqual((await f.invoke(CHANNELS.state)).state.messages, []);
});
