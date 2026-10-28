'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const A = require('./skin-actions.cjs');
const L = require('./codex-locale.cjs');

const MODES = ['pet', 'startup', 'both'];
const DURATION_MS = 7600;
const CHANNELS = ['get', 'set', 'preview', 'scene', 'ready', 'finish'];
const COPY = {
  'zh-CN': { menu: '启动演出', pet: '仅桌宠', startup: '仅启动演出', both: '桌宠与启动演出', preview: '预览演出', skip: '跳过', subject: '白龙娘', status: ['连接建立', '角色档案', '龙翼展开', '准备就绪'], detail: '白角 · 龙翼 · 龙尾' },
  en: { menu: 'Startup scene', pet: 'Pet only', startup: 'Startup scene only', both: 'Pet and startup scene', preview: 'Preview scene', skip: 'Skip', subject: 'Dragon Girl', status: ['LINK ESTABLISHED', 'CHARACTER FILE', 'WINGS UNFOLDED', 'READY'], detail: 'WHITE HORNS · DRAGON WINGS · TAIL' },
};

function createLaunchQueue() {
  let event = null;
  const queue = {
    push(reason) {
      if (!['codex', 'manual'].includes(reason)) throw new Error('invalid-startup-reason');
      event = { id: randomUUID(), reason };
    },
    take() { const next = event; event = null; return { event: next }; },
    request(value) {
      if (!value || value.reason !== 'codex' || Object.keys(value).some(key => key !== 'reason')) throw new Error('invalid-startup-reason');
      queue.push('codex');
    },
  };
  return queue;
}

function createController({ electron, dataRoot, fileRoot = __dirname, timers = globalThis, hostRequest, onPetEnabled = () => {}, onModeChanged = () => {} }) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error('startup-data-root-required');
  const { app, BrowserWindow, ipcMain, screen } = electron;
  const preferenceFile = path.join(dataRoot, 'startup.json');
  let mode = 'pet';
  try { const saved = JSON.parse(fs.readFileSync(preferenceFile, 'utf8')); if (MODES.includes(saved.mode)) mode = saved.mode; }
  catch { /* 首次安装或损坏偏好均保持仅桌宠，不突然弹出演出。 */ }
  let windowRef = null, scene = null, timeout = null, disposed = false, pollTimer = null, polling = false;
  let writes = Promise.resolve();
  const locale = () => L.getLocale();
  const state = () => ({ mode, locale: locale() });
  const petEnabled = () => mode !== 'startup';
  const petUrl = pathToFileURL(path.join(fileRoot, 'index.html')).href;
  function trustedPet(event) {
    try { const url = new URL(event.sender.getURL()); url.search = ''; url.hash = ''; return url.href === petUrl && Boolean(BrowserWindow.fromWebContents(event.sender)); }
    catch { return false; }
  }
  const trustedScene = event => windowRef && !windowRef.isDestroyed() && event.sender === windowRef.webContents;
  function publish() {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && trustedPet({ sender: win.webContents })) win.webContents.send('codex-startup:changed', state());
  }
  function finish() {
    const win = windowRef;
    windowRef = null; scene = null;
    if (timeout !== null) timers.clearTimeout(timeout);
    timeout = null;
    if (win && !win.isDestroyed()) win.close();
  }
  function setMode(next) {
    if (!MODES.includes(next)) return Promise.reject(new Error('invalid-startup-mode'));
    const operation = writes.catch(() => {}).then(async () => {
      if (disposed) throw new Error('startup-disposed');
      const temporary = preferenceFile + '.tmp-' + randomUUID();
      await fs.promises.mkdir(path.dirname(preferenceFile), { recursive: true });
      try {
        await fs.promises.writeFile(temporary, JSON.stringify({ schemaVersion: 1, mode: next }, null, 2));
        await fs.promises.rename(temporary, preferenceFile);
      } catch (error) { await fs.promises.unlink(temporary).catch(() => {}); throw error; }
      mode = next;
      if (mode === 'pet') finish();
      await onPetEnabled(petEnabled());
      publish();
      await onModeChanged();
      return state();
    });
    writes = operation;
    return operation;
  }
  function videoUrl() {
    try {
      const directory = path.join(dataRoot, 'skins', 'white-dragon');
      const manifest = A.normalizeManifest(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')));
      const profile = manifest.profiles.idle;
      if (profile.type !== 'video') return null;
      const file = path.join(directory, profile.file);
      const realDirectory = fs.realpathSync(directory), realFile = fs.realpathSync(file);
      if (path.dirname(realFile) !== realDirectory) return null;
      const header = Buffer.alloc(512), descriptor = fs.openSync(file, 'r');
      let length;
      try { length = fs.readSync(descriptor, header, 0, header.length, 0); } finally { fs.closeSync(descriptor); }
      if (length < 12 || !header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) || !header.subarray(4, length).includes(Buffer.from('4282847765626d', 'hex'))) return null;
      return pathToFileURL(file).href;
    } catch { return null; }
  }
  async function open(reason) {
    if (disposed || windowRef || !['preview', 'codex', 'manual'].includes(reason)) return false;
    if (reason === 'codex' && mode === 'pet' || reason === 'manual' && mode !== 'startup') return false;
    const video = videoUrl();
    if (!video) return false;
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(area.width, 1280), height = Math.min(area.height, 800);
    const win = new BrowserWindow({
      x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height,
      frame: false, show: false, resizable: false, maximizable: false, minimizable: false, skipTaskbar: true,
      alwaysOnTop: true, backgroundColor: '#070b16', autoHideMenuBar: true,
      webPreferences: { preload: path.join(fileRoot, 'startup-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    windowRef = win;
    scene = { video, durationMs: DURATION_MS, locale: locale(), copy: COPY[locale()] || COPY.en };
    // 主进程超时独立于渲染器；视频加载失败或页面卡住也不会留下遮挡窗口。
    timeout = timers.setTimeout(finish, 12000);
    timeout?.unref?.();
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('before-input-event', (event, input) => { if (input.key === 'Escape' && input.type === 'keyDown') { event.preventDefault(); finish(); } });
    win.webContents.on('render-process-gone', finish);
    win.once('closed', () => { if (windowRef === win) finish(); });
    try { await win.loadFile(path.join(fileRoot, 'startup-window.html')); }
    catch { if (windowRef === win) finish(); return false; }
    return !win.isDestroyed();
  }
  const requirePet = event => { if (!trustedPet(event)) throw new Error('startup-sender-denied'); };
  ipcMain.handle('codex-startup:get', event => { requirePet(event); return state(); });
  ipcMain.handle('codex-startup:set', (event, value) => {
    requirePet(event);
    if (!value || Object.keys(value).some(key => key !== 'mode')) throw new Error('invalid-startup-mode');
    return setMode(value.mode);
  });
  ipcMain.handle('codex-startup:preview', event => { requirePet(event); return open('preview'); });
  ipcMain.handle('codex-startup:scene', event => { if (!trustedScene(event)) throw new Error('startup-sender-denied'); return scene; });
  ipcMain.handle('codex-startup:ready', event => { if (!trustedScene(event)) throw new Error('startup-sender-denied'); windowRef.show(); });
  ipcMain.handle('codex-startup:finish', event => { if (!trustedScene(event)) throw new Error('startup-sender-denied'); finish(); });
  async function poll() {
    if (disposed || polling || typeof hostRequest !== 'function') return;
    polling = true;
    try {
      const response = await hostRequest('POST', '/dsh-pet-7340/codex-startup/pending');
      if (!disposed && response.status === 200) {
        const reason = JSON.parse(response.body).event?.reason;
        if (['codex', 'manual'].includes(reason)) await open(reason);
      }
    } catch { /* 宿主短暂不可用不产生演出，也不重复投递旧事件。 */ }
    finally { polling = false; }
  }
  function start(reason = 'manual') {
    if (disposed || pollTimer !== null) return;
    // 正式宿主只消费一次启动事件；helper因配置变更重建时不能重播。
    if (typeof hostRequest !== 'function') void open(reason);
    pollTimer = timers.setInterval(poll, 1500); pollTimer?.unref?.();
    void poll();
  }
  function trayItems() {
    const copy = COPY[locale()] || COPY.en;
    return [{ label: copy.menu, submenu: [
      ...MODES.map(value => ({ label: copy[value], type: 'radio', checked: mode === value, click: () => { void setMode(value).catch(() => {}); } })),
      { type: 'separator' }, { label: copy.preview, click: () => { void open('preview'); } },
    ] }];
  }
  function dispose() {
    if (disposed) return;
    disposed = true; finish();
    if (pollTimer !== null) timers.clearInterval(pollTimer);
    pollTimer = null;
    for (const name of CHANNELS) ipcMain.removeHandler('codex-startup:' + name);
    app.removeListener('before-quit', dispose);
  }
  app.once('before-quit', dispose);
  return { state, petEnabled, setMode, open, start, trayItems, dispose };
}

function install({ electronApi, reason = process.env.CODEX_PET_LAUNCH_REASON || 'manual', disabled = false, ...options }) {
  const electron = electronApi || require('electron');
  const controller = createController({ electron, ...options });
  if (!disabled) void electron.app.whenReady().then(() => controller.start(reason));
  return controller;
}
function installPreload({ electronApi } = {}) {
  const { contextBridge, ipcRenderer } = electronApi || require('electron');
  contextBridge.exposeInMainWorld('codexStartup', {
    getState: () => ipcRenderer.invoke('codex-startup:get'),
    setMode: mode => ipcRenderer.invoke('codex-startup:set', { mode }),
    preview: () => ipcRenderer.invoke('codex-startup:preview'),
    onChanged: callback => { const handler = (_event, value) => callback(value); ipcRenderer.on('codex-startup:changed', handler); return () => ipcRenderer.removeListener('codex-startup:changed', handler); },
  });
}
module.exports = { createLaunchQueue, createController, install, installPreload };
