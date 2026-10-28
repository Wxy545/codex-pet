'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const L = require('./codex-locale.cjs');

const CHAT_PATH = '/dsh-pet-7340/codex-chat';
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_TOTAL = 12 * 1024 * 1024;
const CHANNELS = Object.freeze({
  open: 'dragon-chat:open', state: 'dragon-chat:state', changed: 'dragon-chat:changed',
  choose: 'dragon-chat:choose', paste: 'dragon-chat:paste', remove: 'dragon-chat:remove',
  send: 'dragon-chat:send', reset: 'dragon-chat:reset', task: 'dragon-chat:task',
});
const ERRORS = Object.freeze({
  unauthorized: '此窗口不能执行这项操作。', invalid_input: '请填写简短文字或选择图片。',
  invalid_image: '图片无效，请选择 PNG、JPEG 或 WebP 图片。',
  image_unsupported: '仅支持本机 PNG、JPEG 和 WebP 图片。',
  image_limit: '最多4张图片，每张不超过5MiB，合计不超过12MiB。',
  clipboard_empty: '剪贴板中没有可以粘贴的图片。', busy: '上一轮请求仍在处理，请等待结束。',
  process_failed: '这次没有收到回复，请稍后重试。', host_unavailable: '暂时无法连接桌宠服务，请稍后重试。',
  timeout: 'Codex回复超时，请稍后重试。', empty_reply: 'Codex没有返回文字，请再说一次。',
  output_limit: '这次回复过长，请换个简短问题。', tools_disabled: '操作任务请到操作面板确认目录和权限后提交。',
  closed: '原窗口已关闭，本轮回复已丢弃。', task_menu: '请在桌宠上右键，选择“操作任务”。',
  character_changed: '形象已经切换，请重新说一句。',
});
const failure = code => {
  const safe = Object.hasOwn(ERRORS, code) ? code : 'host_unavailable';
  return { ok: false, code: safe, message: L.t(ERRORS[safe]) };
};

function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP'))) return 'image/webp';
  return null;
}

/** 图片路径只来自原生选择框；渲染端只能引用本窗口的附件ID。 */
function createController({ hostRequest, electron, fileRoot = __dirname, fsImpl = {}, openTaskPanel }) {
  if (typeof hostRequest !== 'function') throw new TypeError('hostRequest is required');
  const { BrowserWindow, ipcMain, app, dialog, clipboard } = electron;
  const io = { open: fs.open, ...fsImpl };
  const panelFile = path.join(fileRoot, 'chat-window.html');
  const panelUrl = pathToFileURL(panelFile).href;
  const petUrl = new URL(pathToFileURL(path.join(fileRoot, 'index.html')).href);
  let windowRef = null;
  let history = [];
  const histories = new Map();
  let identity = { id: 'bluefish', name: L.t('蓝色大肥鱼'), locale: L.getLocale() };
  let identityRevision = 0;
  let attachments = new Map();
  let busy = false;
  let selecting = null;
  let generation = 0;
  let disposed = false;

  const snapshot = () => ({
    busy, selecting: Boolean(selecting), locale: identity.locale, character: { ...identity }, revision: identityRevision,
    messages: history.map(message => ({ ...message, images: message.images.map(image => ({ ...image })) })),
    attachments: [...attachments.values()].map(image => ({ ...image })),
  });
  const withState = value => ({ ...value, state: snapshot() });
  function publish() {
    histories.set(identity.id, history);
    if (disposed || !windowRef || windowRef.isDestroyed()) return;
    try { windowRef.webContents.send(CHANNELS.changed, snapshot()); } catch { /* 窗口退出时丢弃更新。 */ }
  }
  function onCharacterChanged(value) {
    if (!value || !['white-dragon', 'bluefish'].includes(value.id) || typeof value.name !== 'string' || !['zh-CN', 'en'].includes(value.locale)) return false;
    identityRevision++;
    if (identity.id !== value.id || identity.locale !== value.locale) {
      histories.set(identity.id, history);
      history = histories.get(value.id) || [];
      generation++; attachments.clear(); selecting = null;
    }
    identity = { id: value.id, name: value.name.slice(0, 80), locale: value.locale };
    L.setLocale(identity.locale);
    windowRef?.setTitle?.(`Codex Pet · ${identity.name} · ${L.t('对话')}`);
    publish();
    return true;
  }
  async function refreshCharacter() {
    const revision = identityRevision;
    try {
      const response = await hostRequest('GET', '/dsh-pet-7340/codex-character');
      if (response?.status !== 200) return false;
      const value = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      // 切换事件比在途读取更新，迟到的旧GET不能把当前角色改回去。
      return revision !== identityRevision || onCharacterChanged(value);
    } catch { return false; }
  }
  const owned = event => {
    const contents = windowRef?.webContents;
    return !disposed && contents && !windowRef.isDestroyed() && event?.sender === contents
      && event.senderFrame === contents.mainFrame && Boolean(event.senderFrame) && contents.getURL() === panelUrl;
  };
  const petSender = event => {
    if (!event?.sender || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed?.()) return false;
    try {
      const url = new URL(event.sender.getURL());
      return url.protocol === 'file:' && url.pathname === petUrl.pathname && Boolean(BrowserWindow.fromWebContents(event.sender));
    } catch { return false; }
  };
  const imageValue = (bytes, name) => {
    if (!bytes.length || bytes.length > MAX_IMAGE) throw Object.assign(new Error(), { code: 'image_limit' });
    const mime = imageMime(bytes);
    if (!mime) throw Object.assign(new Error(), { code: 'invalid_image' });
    return { id: randomUUID(), name: String(name).slice(0, 200), mime, size: bytes.length, dataUrl: 'data:' + mime + ';base64,' + bytes.toString('base64') };
  };
  function addImages(values) {
    const all = [...attachments.values(), ...values];
    if (all.length > 4 || all.reduce((sum, image) => sum + image.size, 0) > MAX_TOTAL) throw Object.assign(new Error(), { code: 'image_limit' });
    for (const value of values) attachments.set(value.id, value);
  }
  async function readImage(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || /^(\\\\|\/\/)/.test(file)) throw Object.assign(new Error(), { code: 'image_unsupported' });
    const handle = await io.open(file, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE) throw Object.assign(new Error(), { code: 'image_limit' });
      const buffer = Buffer.alloc(info.size + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_IMAGE) throw Object.assign(new Error(), { code: 'image_limit' });
      return imageValue(buffer.subarray(0, bytesRead), path.basename(file));
    } finally { await handle.close(); }
  }
  function compactHistory() {
    while (history.length > 64 || history.reduce((sum, message) => sum + message.text.length, 0) > 64000) history.shift();
    const images = history.flatMap(message => message.images);
    let count = images.length; let size = images.reduce((sum, image) => sum + image.size, 0);
    for (const message of history) {
      while (message.images.length && (count > 4 || size > MAX_TOTAL)) {
        const image = message.images.shift(); count--; size -= image.size; message.imageNote = true;
      }
    }
  }
  function requestMessages() {
    const recent = history.slice(-12);
    while (recent.length > 1 && recent.reduce((sum, message) => sum + message.text.length, 0) > 24000) recent.shift();
    return [
      ...recent.map(message => ({
        role: message.role,
        content: message.images.length
          ? [{ type: 'text', text: message.text || L.t('看看这些图片。') }, ...message.images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }))]
          : message.text || (message.imageNote ? L.t('[较早图片]') : ''),
      })),
    ];
  }

  async function open() {
    if (disposed) return;
    await app.whenReady();
    if (disposed) return;
    await refreshCharacter();
    if (disposed) return;
    if (windowRef && !windowRef.isDestroyed()) {
      if (windowRef.isMinimized()) windowRef.restore();
      windowRef.show(); windowRef.focus(); return;
    }
    const win = new BrowserWindow({
      width: 760, height: 780, minWidth: 520, minHeight: 560,
      title: `Codex Pet · ${identity.name} · ${L.t('对话')}`, backgroundColor: '#f7f8fa', show: false, autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(fileRoot, 'chat-preload.cjs'), nodeIntegration: false, contextIsolation: true,
        sandbox: true, webSecurity: true, spellcheck: false, partition: 'codex-chat-panel',
      },
    });
    windowRef = win;
    win.setMenu?.(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== panelUrl) event.preventDefault(); });
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.session?.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
    win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
    win.once('closed', () => {
      if (windowRef !== win) return;
      windowRef = null; generation++; history = []; histories.clear(); attachments.clear(); selecting = null;
      // 宿主桥接当前没有取消信号；保留busy直到旧请求结束，重开窗口也不能并发再发一轮。
    });
    try { await win.loadFile(panelFile); } catch { if (!win.isDestroyed()) win.destroy(); }
  }

  const handlers = {
    [CHANNELS.state]: async event => owned(event) ? withState({ ok: true }) : failure('unauthorized'),
    [CHANNELS.choose]: async event => {
      if (!owned(event)) return failure('unauthorized');
      if (busy || selecting) return withState(failure('busy'));
      const epoch = generation; const token = Symbol(); selecting = token; publish();
      let result;
      try {
        const chosen = await dialog.showOpenDialog(windowRef, { title: L.t('选择图片'), buttonLabel: L.t('添加图片'), properties: ['openFile', 'multiSelections', 'dontAddToRecent'], filters: [{ name: L.t('图片'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
        if (chosen.canceled) result = { ok: true, cancelled: true };
        else if (!Array.isArray(chosen.filePaths) || chosen.filePaths.length + attachments.size > 4) result = failure('image_limit');
        else {
          const values = [];
          for (const file of chosen.filePaths) values.push(await readImage(file));
          if (generation !== epoch || disposed) result = failure('closed');
          else { addImages(values); result = { ok: true }; }
        }
      } catch (error) { result = failure(error.code === 'image_limit' || error.code === 'image_unsupported' ? error.code : 'invalid_image'); }
      finally { if (selecting === token) selecting = null; publish(); }
      return withState(result);
    },
    [CHANNELS.paste]: async event => {
      if (!owned(event)) return failure('unauthorized');
      if (busy || selecting) return withState(failure('busy'));
      try {
        const image = clipboard.readImage();
        if (!image || image.isEmpty()) return withState(failure('clipboard_empty'));
        addImages([imageValue(image.toPNG(), L.t('剪贴板图片.png'))]);
        publish(); return withState({ ok: true });
      } catch (error) { return withState(failure(error.code === 'image_limit' ? 'image_limit' : 'invalid_image')); }
    },
    [CHANNELS.remove]: async (event, id) => {
      if (!owned(event)) return failure('unauthorized');
      if (busy || selecting) return withState(failure('busy'));
      if (typeof id !== 'string' || !attachments.delete(id)) return withState(failure('invalid_input'));
      publish(); return withState({ ok: true });
    },
    [CHANNELS.reset]: async event => {
      if (!owned(event)) return failure('unauthorized');
      if (busy || selecting) return withState(failure('busy'));
      generation++; history = []; attachments.clear(); publish(); return withState({ ok: true });
    },
    [CHANNELS.send]: async (event, value) => {
      if (!owned(event)) return failure('unauthorized');
      if (busy || selecting) return withState(failure('busy'));
      if (!value || Object.keys(value).some(key => !['text', 'imageIds'].includes(key)) || typeof value.text !== 'string' || value.text.length > 8192 || !Array.isArray(value.imageIds) || value.imageIds.length > 4) return withState(failure('invalid_input'));
      const ids = value.imageIds;
      if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !attachments.has(id)) || (!value.text.trim() && !ids.length)) return withState(failure('invalid_input'));
      const validationEpoch = generation;
      // 身份GET也属于提交过程；等待期间关闭或切角色后不能偷偷启动模型请求。
      busy = true; publish();
      const ready = await refreshCharacter();
      if (!owned(event) || generation !== validationEpoch || !ready || ids.some(id => !attachments.has(id))) {
        busy = false; publish();
        return withState(failure(!owned(event) ? 'closed' : generation !== validationEpoch ? 'character_changed' : !ready ? 'host_unavailable' : 'invalid_input'));
      }
      const epoch = generation;
      const requestWindow = windowRef;
      const requestCharacterId = identity.id;
      const beforeHistory = history;
      const beforeAttachments = attachments;
      const selected = ids.map(id => attachments.get(id));
      history = history.map(message => ({ ...message, images: message.images.slice() }));
      history.push({ role: 'user', text: value.text.trim(), images: selected });
      compactHistory(); attachments = new Map(); busy = true; publish();
      let result;
      try {
        const response = await hostRequest('POST', CHAT_PATH, JSON.stringify({ messages: requestMessages(), stream: false }));
        if (generation !== epoch || disposed) result = failure(disposed || windowRef !== requestWindow ? 'closed' : 'character_changed');
        else {
          let payload;
          try { payload = typeof response?.body === 'string' ? JSON.parse(response.body) : response?.body; } catch { payload = null; }
          if (!response || response.status < 200 || response.status >= 300) result = failure(payload?.error?.code);
          else {
            const text = payload?.choices?.[0]?.message?.content;
            if (typeof text !== 'string' || !text.trim()) result = failure('empty_reply');
            else {
              history.push({ role: 'assistant', text: text.slice(0, 4000), images: [] });
              compactHistory(); result = { ok: true };
            }
          }
        }
      } catch { result = failure('host_unavailable'); }
      finally {
        busy = false;
        if (generation === epoch && !disposed && result?.ok !== true) { history = beforeHistory; attachments = beforeAttachments; }
        else if (generation !== epoch && !disposed && windowRef === requestWindow) {
          // 取消的旧轮次只撤回原角色桶，不能在新角色历史留下半条用户消息。
          histories.set(requestCharacterId, beforeHistory);
          if (identity.id === requestCharacterId) history = beforeHistory;
        }
        publish();
      }
      return withState(result || failure('host_unavailable'));
    },
    [CHANNELS.task]: async event => {
      if (!owned(event)) return failure('unauthorized');
      if (typeof openTaskPanel !== 'function') return withState(failure('task_menu'));
      try { await openTaskPanel(); return withState({ ok: true }); } catch { return withState(failure('host_unavailable')); }
    },
  };
  const openListener = event => { if (petSender(event)) void open().catch(() => {}); };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  ipcMain.on(CHANNELS.open, openListener);
  function dispose() {
    if (disposed) return;
    disposed = true; generation++; history = []; histories.clear(); attachments.clear(); selecting = null;
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
    ipcMain.removeListener(CHANNELS.open, openListener);
    app.removeListener('before-quit', dispose);
    if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
    windowRef = null;
  }
  app.once('before-quit', dispose);
  return { open, dispose, onCharacterChanged };
}

function install(options) { return createController({ ...options, electron: options.electron || require('electron') }); }
function installPreload(electron = require('electron')) {
  electron.contextBridge.exposeInMainWorld('codexChatPanel', Object.freeze({ open: () => electron.ipcRenderer.send(CHANNELS.open) }));
}
module.exports = { createController, install, installPreload, CHANNELS };
