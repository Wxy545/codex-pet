'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const L = require('./codex-locale.cjs');

const TASK_PATH = '/dsh-pet-7340/codex-tasks';
const CHANNELS = Object.freeze({
  open: 'dragon-task:open', state: 'dragon-task:state', directory: 'dragon-task:directory',
  submit: 'dragon-task:submit', cancel: 'dragon-task:cancel', copy: 'dragon-task:copy',
});
const ACTIVE = new Set(['running', 'cancelling']);
const STATES = new Set(['idle', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'timed_out']);
const PROGRESS = Object.freeze({
  thinking: '正在思考本次任务', working: '正在处理所选目录中的任务',
  result: '正在整理结果', cancelling: '正在停止本次任务', completed: '执行已结束，请核对返回结果',
  failed: '任务未能完成', cancelled: '任务已取消', timed_out: '任务已超时',
});
const ERRORS = Object.freeze({
  unauthorized: '此窗口不能执行这项操作。', invalid_input: '请填写任务正文并选择本次权限。',
  confirmation_required: '请核对目录、任务和权限后点击确认执行。',
  invalid_cwd: '工作目录已变化或不可用，请重新选择。', directory_required: '请先选择工作目录。',
  busy: '已有聊天或操作任务正在运行，请等待完成或先取消。',
  host_unavailable: '暂时无法连接桌宠服务，请稍后重试。',
  process_failed: '本次任务未能完成，请检查 Codex 状态后重试。',
  timeout: '本次任务已超时。', output_limit: '任务输出超过上限，已停止执行。',
  permission_violation: '本次任务超出只读权限，已停止执行。', tools_disabled: '本次任务请求了未开放的外部能力。',
  empty_reply: '任务已结束，但没有返回结果摘要。', cancelled: '本次任务已取消。',
  stale_task: '任务状态已变化，请刷新后重试。', empty_result: '当前没有可以复制的结果。',
});

const knownError = code => typeof code === 'string' && Object.hasOwn(ERRORS, code);
const failure = code => ({ ok: false, code: knownError(code) ? code : 'host_unavailable', message: L.t(knownError(code) ? ERRORS[code] : ERRORS.host_unavailable), locale: L.getLocale() });
const samePath = (left, right) => process.platform === 'win32'
  ? String(left).toLowerCase() === String(right).toLowerCase() : left === right;

/** 只传递结果摘要与固定进度文案，工具命令、推理和原始错误不进入面板。 */
function sanitizeSnapshot(value) {
  if (!value || typeof value !== 'object' || !STATES.has(value.state)) return null;
  const result = {
    state: value.state,
    locale: L.getLocale(),
    progress: Array.isArray(value.progress) ? value.progress.slice(-24).flatMap(item => {
      if (!item || typeof item.kind !== 'string' || !Object.hasOwn(PROGRESS, item.kind)) return [];
      return [{ kind: item.kind, text: L.t(PROGRESS[item.kind]), at: typeof item.at === 'string' ? item.at.slice(0, 40) : '' }];
    }) : [],
    summary: typeof value.summary === 'string' ? value.summary.slice(0, 64000) : '',
  };
  if (typeof value.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value.id)) result.id = value.id;
  if (typeof value.cwd === 'string' && path.isAbsolute(value.cwd)) result.cwd = value.cwd.slice(0, 32768);
  if (['read-only', 'workspace-write'].includes(value.permission)) result.permission = value.permission;
  if (value.error && knownError(value.error.code)) result.error = { code: value.error.code, message: L.t(ERRORS[value.error.code]) };
  return result;
}

/** 主进程拥有目录选择与固定宿主路由，渲染端不能传任意 IPC 或替换已选目录。 */
function createController({ hostRequest, electron, fileRoot = __dirname, fsImpl = {}, canUse = () => true }) {
  if (typeof hostRequest !== 'function') throw new TypeError('hostRequest is required');
  const { BrowserWindow, ipcMain, app, dialog, clipboard } = electron;
  const io = { realpath: fs.realpath, stat: fs.stat, ...fsImpl };
  const panelFile = path.join(fileRoot, 'task-window.html');
  const panelUrl = pathToFileURL(panelFile).href;
  const petUrl = pathToFileURL(path.join(fileRoot, 'index.html')).href;
  let windowRef = null;
  let selectedDirectory = '';
  let submitPending = false;
  let disposed = false;
  let opening = null;
  const available = () => { try { return !disposed && canUse() === true; } catch { return false; } };

  const owned = event => {
    const contents = windowRef?.webContents;
    if (!available() || !contents || windowRef.isDestroyed() || event?.sender !== contents) return false;
    if (contents.mainFrame && event.senderFrame !== contents.mainFrame) return false;
    return contents.getURL() === panelUrl;
  };
  const petSender = event => {
    if (!event?.sender || event.sender.isDestroyed?.()) return false;
    if (event.sender.mainFrame && event.senderFrame !== event.sender.mainFrame) return false;
    const source = event.sender.getURL();
    try {
      const url = new URL(source);
      const expected = new URL(petUrl);
      return url.protocol === 'file:' && url.pathname === expected.pathname && Boolean(BrowserWindow.fromWebContents(event.sender));
    } catch { return false; }
  };

  async function request(method, route, body) {
    if (!available()) return failure('unauthorized');
    try {
      const response = await hostRequest(method, route, body === undefined ? undefined : JSON.stringify(body));
      if (!available()) return failure('unauthorized');
      const payload = typeof response?.body === 'string' ? JSON.parse(response.body) : response?.body;
      if (!response || response.status < 200 || response.status >= 300) return failure(payload?.error?.code);
      const snapshot = sanitizeSnapshot(payload);
      return snapshot ? { ok: true, snapshot, selectedDirectory } : failure('host_unavailable');
    } catch { return failure('host_unavailable'); }
  }

  async function open() {
    if (!available()) throw new Error('unavailable');
    await app.whenReady();
    if (!available()) throw new Error('unavailable');
    if (opening) return opening;
    if (windowRef && !windowRef.isDestroyed()) {
      if (windowRef.isMinimized()) windowRef.restore();
      windowRef.show(); windowRef.focus(); return;
    }
    // 首次加载期间的重复入口共同等待，不提前隐藏发起导航的旧面板。
    opening = (async () => {
      const win = new BrowserWindow({
        width: 1040, height: 800, minWidth: 560, minHeight: 580,
        title: `Codex Pet · ${L.t('操作任务')}`, backgroundColor: '#15171c', show: false, autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(fileRoot, 'task-preload.cjs'), nodeIntegration: false,
          contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false,
        },
      });
      windowRef = win;
      win.setMenu?.(null);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, url) => { if (url !== panelUrl) event.preventDefault(); });
      win.webContents.on('will-attach-webview', event => event.preventDefault());
      win.once('ready-to-show', () => { if (available() && !win.isDestroyed()) win.show(); });
      // 关面板只关观察窗口；任务是否取消由面板的取消按钮明确决定。
      win.once('closed', () => { if (windowRef === win) windowRef = null; });
      try {
        await win.loadFile(panelFile);
        if (!available() || win.isDestroyed()) throw new Error('unavailable');
      } catch { if (!win.isDestroyed()) win.destroy(); throw new Error('unavailable'); }
    })();
    try { await opening; } finally { opening = null; }
  }

  const handlers = {
    [CHANNELS.state]: async event => owned(event) ? request('GET', TASK_PATH) : failure('unauthorized'),
    [CHANNELS.directory]: async event => {
      if (!owned(event)) return failure('unauthorized');
      if (submitPending) return failure('busy');
      try {
        const chosen = await dialog.showOpenDialog(windowRef, { title: L.t('选择本次任务的工作目录'), buttonLabel: L.t('使用这个目录'), properties: ['openDirectory', 'dontAddToRecent'], ...(selectedDirectory ? { defaultPath: selectedDirectory } : {}) });
        if (chosen.canceled || chosen.filePaths.length !== 1) return { ok: true, cancelled: true, directory: selectedDirectory };
        const directory = await io.realpath(chosen.filePaths[0]);
        if (!path.isAbsolute(directory) || !(await io.stat(directory)).isDirectory()) return failure('invalid_cwd');
        // 文件夹对话框可能早于提交打开；异步返回后也不能改掉正在确认的目录。
        if (!owned(event)) return failure('unauthorized');
        if (submitPending) return failure('busy');
        selectedDirectory = directory;
        return { ok: true, directory };
      } catch { return failure('invalid_cwd'); }
    },
    [CHANNELS.submit]: async (event, body) => {
      if (!owned(event)) return failure('unauthorized');
      if (submitPending) return failure('busy');
      if (!selectedDirectory) return failure('directory_required');
      const submittedDirectory = selectedDirectory;
      if (!body || body.confirmed !== true) return failure('confirmation_required');
      if (!samePath(body.cwd, submittedDirectory)) return failure('invalid_cwd');
      if (typeof body.task !== 'string' || !body.task.trim() || body.task.length > 12000 || !['read-only', 'workspace-write'].includes(body.permission)) return failure('invalid_input');
      submitPending = true;
      try {
        const currentDirectory = await io.realpath(submittedDirectory);
        if (!samePath(currentDirectory, submittedDirectory) || !(await io.stat(currentDirectory)).isDirectory()) return failure('invalid_cwd');
        return await request('POST', TASK_PATH, { cwd: submittedDirectory, task: body.task.trim(), permission: body.permission, confirmed: true });
      } catch { return failure('invalid_cwd'); }
      finally { submitPending = false; }
    },
    [CHANNELS.cancel]: async (event, id) => {
      if (!owned(event)) return failure('unauthorized');
      const current = await request('GET', TASK_PATH);
      if (!current.ok) return current;
      if (typeof id !== 'string' || current.snapshot.id !== id || !ACTIVE.has(current.snapshot.state)) return failure('stale_task');
      try {
        if (!available()) return failure('unauthorized');
        const response = await hostRequest('POST', TASK_PATH + '/cancel', JSON.stringify({ id }));
        if (!response || response.status < 200 || response.status >= 300) return failure('stale_task');
      } catch { return failure('host_unavailable'); }
      return request('GET', TASK_PATH);
    },
    [CHANNELS.copy]: async event => {
      if (!owned(event)) return failure('unauthorized');
      const current = await request('GET', TASK_PATH);
      if (!current.ok) return current;
      if (!current.snapshot.summary) return failure('empty_result');
      try { clipboard.writeText(current.snapshot.summary); return { ok: true }; }
      catch { return failure('host_unavailable'); }
    },
  };
  const openListener = event => { if (petSender(event)) void open().catch(() => {}); };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  ipcMain.on(CHANNELS.open, openListener);
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
    ipcMain.removeListener(CHANNELS.open, openListener);
    app.removeListener('before-quit', dispose);
    if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
    windowRef = null;
  }
  app.once('before-quit', dispose);
  const hide = () => { if (windowRef && !windowRef.isDestroyed()) windowRef.hide(); };
  return { open, hide, dispose };
}

function install(options) { return createController({ ...options, electron: options.electron || require('electron') }); }

/** 现有宠物 preload 只获得“打开面板”，任务能力留在独立窗口。 */
function installPreload(electron = require('electron')) {
  electron.contextBridge.exposeInMainWorld('codexTaskPanel', Object.freeze({ open: () => electron.ipcRenderer.send(CHANNELS.open) }));
}

module.exports = { install, installPreload, createController, sanitizeSnapshot, CHANNELS };
