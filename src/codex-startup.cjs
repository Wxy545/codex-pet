'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const A = require('./skin-actions.cjs');
const L = require('./codex-locale.cjs');

const MODES = ['pet', 'startup', 'both'];
const DURATION_MS = 14400;
const FILM_DURATION_MS = 12000;
const FILM_MAX_BYTES = 96 * 1024 * 1024;
const WATCHDOG_MS = 22000;
const CHANNELS = ['get', 'set', 'preview', 'scene', 'target', 'ready', 'finish'];
const PROFILES = ['idle', 'wing-care', 'greeting', 'turn', 'working', 'magic', 'success'];
const COPY = {
  'zh-CN': { menu: '启动演出', pet: '仅桌宠', startup: '仅启动演出', both: '桌宠与启动演出', preview: '预览演出', skip: '跳过', subject: '白龙娘', status: ['连接建立', '角色档案', '龙翼展开', '准备就绪'], detail: '白角 · 龙翼 · 龙尾' },
  en: { menu: 'Startup scene', pet: 'Pet only', startup: 'Startup scene only', both: 'Pet and startup scene', preview: 'Preview scene', skip: 'Skip', subject: 'Dragon Girl', status: ['LINK ESTABLISHED', 'CHARACTER FILE', 'WINGS UNFOLDED', 'READY'], detail: 'WHITE HORNS · DRAGON WINGS · TAIL' },
};

function normalizeTarget(value) {
  if (!value || value.ok !== true) return { ok: false, ready: false };
  const input = value.bounds;
  const bounds = input && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(input[key]))
    && Math.abs(input.x) <= 1000000 && Math.abs(input.y) <= 1000000
    && input.width >= 1 && input.height >= 1 && input.width <= 32768 && input.height <= 32768
    ? Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(input[key])])) : undefined;
  return { ok: true, ready: value.ready === true && Boolean(bounds), ...(bounds ? { bounds } : {}), ...(typeof value.focused === 'boolean' ? { focused: value.focused } : {}) };
}

/** 启动演出只探测或聚焦当前宿主的主窗；不读取标题、内容或登录数据。 */
function createTargetRequest({ platform = process.platform, fileRoot = __dirname, execFileImpl = execFile, host = process.env.CODEX_PET_HOST || 'codex' } = {}) {
  const script = host === 'workbuddy' ? 'workbuddy-target.ps1' : 'startup-target.ps1';
  return async action => {
    if (!['probe', 'focus'].includes(action)) throw new Error('invalid-startup-target-action');
    if (platform !== 'win32') return { ok: false, ready: false };
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return new Promise(resolve => {
      execFileImpl(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(fileRoot, script), '-Action', action === 'probe' ? 'Probe' : 'Focus'],
        { windowsHide: true, timeout: action === 'focus' && host === 'workbuddy' ? 6500 : 2500, maxBuffer: 4096, encoding: 'utf8' }, (error, stdout) => {
          if (error) return resolve({ ok: false, ready: false });
          try { resolve(normalizeTarget(JSON.parse(stdout.replace(/^\uFEFF/, '').trim()))); }
          catch { resolve({ ok: false, ready: false }); }
        });
    });
  };
}

function createLaunchQueue() {
  let event = null;
  const queue = {
    push(reason) {
      if (!['codex', 'workbuddy', 'manual'].includes(reason)) throw new Error('invalid-startup-reason');
      event = { id: randomUUID(), reason };
    },
    take() { const next = event; event = null; return { event: next }; },
    request(value) {
      if (!value || !['codex', 'workbuddy'].includes(value.reason) || Object.keys(value).some(key => key !== 'reason')) throw new Error('invalid-startup-reason');
      queue.push(value.reason);
    },
  };
  return queue;
}

function createController({ electron, dataRoot, fileRoot = __dirname, timers = globalThis, hostRequest, host = process.env.CODEX_PET_HOST || 'codex', targetRequest, onPetEnabled = () => {}, onModeChanged = () => {} }) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error('startup-data-root-required');
  const currentHost = () => (typeof host === 'function' ? host() : host) === 'workbuddy' ? 'workbuddy' : 'codex';
  const targetRequests = { codex: createTargetRequest({ fileRoot, host: 'codex' }), workbuddy: createTargetRequest({ fileRoot, host: 'workbuddy' }) };
  const requestTarget = (action, selectedHost) => typeof targetRequest === 'function' ? targetRequest(action, selectedHost) : targetRequests[selectedHost](action);
  const { app, BrowserWindow, ipcMain, screen } = electron;
  const preferenceFile = path.join(dataRoot, 'startup.json');
  let mode = 'both';
  try { const saved = JSON.parse(fs.readFileSync(preferenceFile, 'utf8')); if (MODES.includes(saved.mode)) mode = saved.mode; }
  catch { /* 新安装默认同时启用桌宠和演出；已有有效选择保持原样。 */ }
  let windowRef = null, scene = null, timeout = null, disposed = false, pollTimer = null, polling = false;
  let writes = Promise.resolve();
  let opening = false, generation = 0, handoffPending = Promise.resolve();
  const targets = new Map();
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
  function finish({ handoff = true } = {}) {
    const win = windowRef;
    const reason = scene?.reason;
    const selectedHost = scene?.host;
    generation++;
    windowRef = null; scene = null;
    if (timeout !== null) timers.clearTimeout(timeout);
    timeout = null;
    if (handoff && ['codex', 'workbuddy'].includes(reason) && reason === selectedHost && !disposed) {
      // 新演出等上一次交还完成后再建窗，旧调用不能抢走新覆盖层的焦点。
      // 在关闭覆盖层前拉起薄helper，使Windows保留本次主动启动的前台交接权限。
      handoffPending = (async () => { try { return await requestTarget('focus', selectedHost); } catch { return { ok: false, ready: false }; } })();
    }
    // 演出没有待保存数据，不能让beforeunload取消22秒看门狗的退场。
    if (win && !win.isDestroyed()) win.destroy();
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
      if (mode === 'pet') finish({ handoff: false });
      await onPetEnabled(petEnabled());
      publish();
      await onModeChanged();
      return state();
    });
    writes = operation;
    return operation;
  }
  function videoAssets() {
    try {
      const directory = path.join(dataRoot, 'skins', 'white-dragon');
      const manifest = A.normalizeManifest(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')));
      const realDirectory = fs.realpathSync(directory), realDataRoot = fs.realpathSync(dataRoot);
      if (path.relative(realDataRoot, realDirectory) !== path.join('skins', 'white-dragon')) return {};
      const assets = {};
      for (const key of PROFILES) {
        const profile = manifest.profiles[key];
        if (profile?.type !== 'video') continue;
        try {
          const realFile = fs.realpathSync(path.join(directory, profile.file));
          if (path.dirname(realFile) !== realDirectory || !fs.statSync(realFile).isFile()) continue;
          const header = Buffer.alloc(512), descriptor = fs.openSync(realFile, 'r');
          let length;
          try { length = fs.readSync(descriptor, header, 0, header.length, 0); } finally { fs.closeSync(descriptor); }
          if (length < 12 || !header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) || !header.subarray(4, length).includes(Buffer.from('4282847765626d', 'hex'))) continue;
          assets[key] = pathToFileURL(realFile).href;
        } catch { /* 缺失或损坏的可选片段不进入演出，必需idle由调用方检查。 */ }
      }
      return assets;
    } catch { return {}; }
  }
  function cinematicVideo() {
    try {
      const directory = path.join(dataRoot, 'startup-media');
      const file = path.join(directory, 'white-dragon-cinematic.webm');
      const realRoot = fs.realpathSync(dataRoot), realDirectory = fs.realpathSync(directory);
      if (path.relative(realRoot, realDirectory) !== 'startup-media' || fs.lstatSync(directory).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink()) return null;
      const realFile = fs.realpathSync(file), stat = fs.statSync(realFile);
      if (path.dirname(realFile) !== realDirectory || !stat.isFile() || stat.size < 16 || stat.size > FILM_MAX_BYTES) return null;
      const descriptor = fs.openSync(realFile, 'r'), header = Buffer.alloc(512);
      let length;
      try { length = fs.readSync(descriptor, header, 0, header.length, 0); } finally { fs.closeSync(descriptor); }
      if (length < 12 || !header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) || !header.subarray(4, length).includes(Buffer.from('4282847765626d', 'hex'))) return null;
      return pathToFileURL(realFile).href;
    } catch { return null; }
  }
  async function probeTarget(selectedHost = scene?.host || currentHost()) {
    if (disposed) return { ok: false, ready: false };
    if (!targets.has(selectedHost)) targets.set(selectedHost, { at: 0, value: { ok: false, ready: false }, pending: null });
    const target = targets.get(selectedHost);
    if (target.at && Date.now() - target.at < 800) return target.value;
    if (!target.pending) target.pending = Promise.resolve().then(() => requestTarget('probe', selectedHost)).then(value => {
      target.value = normalizeTarget(value); target.at = Date.now(); return target.value;
    }).catch(() => ({ ok: false, ready: false })).finally(() => { target.pending = null; });
    return target.pending;
  }
  const targetView = value => ({ ok: value.ok, ready: value.ready });
  const allowed = (reason, selectedHost = currentHost()) => ['preview', selectedHost, 'manual'].includes(reason) && !(reason === selectedHost && mode === 'pet' || reason === 'manual' && mode !== 'startup');
  async function open(reason) {
    if (disposed || opening || windowRef || !allowed(reason)) return false;
    const selectedHost = currentHost();
    const film = cinematicVideo();
    const assets = film ? {} : videoAssets();
    if (!film && !assets.idle) return false;
    opening = true;
    const epoch = generation;
    try {
      await handoffPending;
      const located = await probeTarget(selectedHost);
      if (disposed || generation !== epoch || currentHost() !== selectedHost || !allowed(reason, selectedHost)) return false;
      let display = screen.getPrimaryDisplay();
      if (located.bounds && typeof screen.getDisplayMatching === 'function') {
        try {
          const bounds = typeof screen.screenToDipRect === 'function' ? screen.screenToDipRect(null, located.bounds) : located.bounds;
          display = screen.getDisplayMatching(bounds);
        } catch { /* 无法定位目标屏幕时使用主屏，不改变真实应用窗口。 */ }
      }
      const area = display.bounds || display.workArea;
      const { width, height } = area;
      const win = new BrowserWindow({
        x: area.x, y: area.y, width, height,
        frame: false, show: false, resizable: false, maximizable: false, minimizable: false, skipTaskbar: true,
        alwaysOnTop: true, transparent: true, backgroundColor: '#00000000', autoHideMenuBar: true,
        webPreferences: { preload: path.join(fileRoot, 'startup-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
      });
      windowRef = win;
      scene = { video: film || assets.idle, assets, film: Boolean(film), reason, host: selectedHost, brand: selectedHost === 'workbuddy' ? 'WorkBuddy' : 'ChatGPT', target: targetView(located), durationMs: film ? FILM_DURATION_MS : DURATION_MS, locale: locale(), copy: COPY[locale()] || COPY.en };
      // 主进程超时独立于渲染器；视频加载失败或页面卡住也不会留下遮挡窗口。
      timeout = timers.setTimeout(finish, WATCHDOG_MS);
      timeout?.unref?.();
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', event => event.preventDefault());
      win.webContents.on('before-input-event', (event, input) => { if (input.key === 'Escape' && input.type === 'keyDown') { event.preventDefault(); finish(); } });
      win.webContents.on('render-process-gone', finish);
      win.once('closed', () => { if (windowRef === win) finish(); });
      try { await win.loadFile(path.join(fileRoot, 'startup-window.html')); }
      catch { if (windowRef === win) finish(); return false; }
      return !win.isDestroyed();
    } finally { opening = false; }
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
  ipcMain.handle('codex-startup:target', async event => { if (!trustedScene(event)) throw new Error('startup-sender-denied'); return targetView(await probeTarget()); });
  ipcMain.handle('codex-startup:ready', event => { if (!trustedScene(event)) throw new Error('startup-sender-denied'); if (scene.reason === 'preview') windowRef.showInactive(); else windowRef.show(); });
  ipcMain.handle('codex-startup:finish', event => { if (!trustedScene(event)) throw new Error('startup-sender-denied'); finish(); });
  async function poll() {
    if (disposed || polling || typeof hostRequest !== 'function') return;
    polling = true;
    try {
      const response = await hostRequest('POST', '/dsh-pet-7340/codex-startup/pending');
      if (!disposed && response.status === 200) {
        const reason = JSON.parse(response.body).event?.reason;
        if (['codex', 'workbuddy', 'manual'].includes(reason)) await open(reason);
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
    disposed = true; finish({ handoff: false });
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
module.exports = { createLaunchQueue, createController, createTargetRequest, normalizeTarget, install, installPreload };
