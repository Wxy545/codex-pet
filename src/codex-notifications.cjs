'use strict';

const { execFile, execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, copyFileSync, unlinkSync, constants: FS_CONSTANTS } = require('node:fs');
const path = require('node:path');
const Locale = require('./codex-locale.cjs');

const APP_USER_MODEL_ID = 'com.wanggong.codex-bluefish';
const NOTICE_PATH = '/dsh-pet-7340/codex-notices';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 只接收通知所需字段，避免异常载荷进入系统通知或日志。 */
function normalizeNotice(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.id !== 'string' || !value.id || value.id.length > 256) return null;
  if (typeof value.title !== 'string' || !value.title.trim()) return null;
  return {
    id: value.id,
    kind: typeof value.kind === 'string' ? value.kind.slice(0, 40) : '',
    title: value.title.trim().slice(0, 120),
    body: typeof value.body === 'string' ? value.body.slice(0, 320) : '',
    threadId: typeof value.threadId === 'string' && UUID.test(value.threadId) ? value.threadId : null,
  };
}

/** 前台状态不可确认时不补发，防止把用户正在阅读的对话重复提示一遍。 */
function notificationDecision(foreground) {
  if (!foreground || foreground.ok !== true || typeof foreground.isCodexForeground !== 'boolean') return 'error';
  return foreground.isCodexForeground ? 'foreground' : 'notify';
}

/** 只提取原生 HRESULT，原始错误文案可能含通知内容，不能直接进日志。 */
function nativeErrorCode(error) {
  const message = typeof error === 'string' ? error : error && typeof error.message === 'string' ? error.message : '';
  const decimal = /HRESULT\s*:\s*(-?\d{1,11})\b/i.exec(message);
  if (decimal) {
    try { return `HRESULT=0x${BigInt.asUintN(32, BigInt(decimal[1])).toString(16).padStart(8, '0')}`; } catch { /* 非法值走固定占位。 */ }
  }
  const hex = /(?:HRESULT\s*[:=]?\s*|^\s*)(0x[0-9a-f]{8})\b/i.exec(message);
  return hex ? `HRESULT=${hex[1].toLowerCase()}` : 'HRESULT=unavailable';
}

function threadUrl(notice, protocolRegistered) {
  return protocolRegistered === true && typeof notice.threadId === 'string' && UUID.test(notice.threadId)
    ? `codex://threads/${notice.threadId}` : null;
}

/** 只允许启动器给出的本机通知路由，不接受凭据、额外参数或其他目标。 */
function noticeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== NOTICE_PATH || !url.port) return null;
    return url.href;
  } catch {
    return null;
  }
}

function createNoticeRequest(value, fetcher = globalThis.fetch) {
  const url = noticeUrl(value);
  return async () => {
    if (!url || typeof fetcher !== 'function') throw new Error('notice-endpoint-invalid');
    const response = await fetcher(url, { method: 'GET', signal: AbortSignal.timeout(4000), redirect: 'error' });
    return { status: response.status, body: await response.text() };
  };
}

/** 改名只迁移本安装目录原有的通知入口，不能覆盖同名的其他快捷方式。 */
function isOwnedShortcut(value, target, allowedArgs) {
  return value && typeof value.target === 'string'
    && value.target.toLowerCase() === target.toLowerCase()
    && value.appUserModelId === APP_USER_MODEL_ID
    && allowedArgs.includes(value.args);
}

/** Windows 通知需要同一 AUMID 的开始菜单快捷方式；只更新本应用原有的那一项。 */
function ensureShortcut({ app, shell }, launcher, log, { platform = process.platform, fsImpl = {}, execFileSyncImpl = execFileSync, locale = Locale.getLocale() } = {}) {
  if (platform !== 'win32') return;
  const io = { existsSync, mkdirSync, copyFileSync, unlinkSync, ...fsImpl };
  const warn = key => log('[Codex Pet] ' + Locale.t(key, {}, locale));
  if (typeof launcher !== 'string' || !path.isAbsolute(launcher) || path.extname(launcher).toLowerCase() !== '.vbs' || !io.existsSync(launcher)) {
    warn('通知快捷方式缺少启动入口。');
    return;
  }
  const directory = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const shortcut = path.join(directory, 'Codex Pet.lnk');
  const legacyShortcuts = ['龙娘桌宠.lnk', 'Codex 大肥鱼桌宠.lnk'].map(name => path.join(directory, name));
  const target = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  const args = `"${launcher}"`;
  const allowedArgs = [args, ...['启动龙娘桌宠.vbs', '启动大肥鱼.vbs'].map(name => `"${path.join(path.dirname(launcher), name)}"`)];
  try {
    // 新名称已被其他程序占用时停止；不能先改写快捷方式或注册表。
    if (io.existsSync(shortcut) && !isOwnedShortcut(shell.readShortcutLink(shortcut), target, allowedArgs)) {
      warn('通知快捷方式名称已被占用。'); return;
    }
    const ownedLegacy = legacyShortcuts.filter(file => io.existsSync(file) && isOwnedShortcut(shell.readShortcutLink(file), target, allowedArgs));
    const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const identity = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_USER_MODEL_ID}`;
    for (const [name, value] of [['DisplayName', 'Codex Pet'], ['IconUri', path.resolve(__dirname, '../../assets/logo.png')]]) {
      execFileSyncImpl(reg, ['add', identity, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true, stdio: 'ignore' });
    }
    io.mkdirSync(directory, { recursive: true });
    const destination = io.existsSync(shortcut) ? shortcut : ownedLegacy[0] || shortcut;
    const written = shell.writeShortcutLink(destination, io.existsSync(destination) ? 'update' : 'create', {
      target, args, appUserModelId: APP_USER_MODEL_ID, description: 'Codex Pet',
    });
    if (!written) { warn('通知快捷方式创建失败。'); return; }
    // 先确保新名称已独占创建，失败时旧入口仍指向可用启动器；绝不覆盖竞态产生的同名项。
    if (destination !== shortcut) io.copyFileSync(destination, shortcut, FS_CONSTANTS.COPYFILE_EXCL);
    for (const file of legacyShortcuts) {
      if (io.existsSync(file) && isOwnedShortcut(shell.readShortcutLink(file), target, allowedArgs)) io.unlinkSync(file);
    }
  } catch { warn('通知快捷方式创建失败。'); }
}

/** 去重容量固定；前台抑制也会消费事件，之后切后台不追发旧通知。 */
class NoticeHistory {
  constructor(limit = 256) {
    this.limit = limit;
    this.ids = new Set();
  }

  take(values) {
    const fresh = [];
    for (const value of Array.isArray(values) ? values.slice(0, 100) : []) {
      const notice = normalizeNotice(value);
      if (!notice || this.ids.has(notice.id)) continue;
      this.ids.add(notice.id);
      while (this.ids.size > this.limit) this.ids.delete(this.ids.values().next().value);
      fresh.push(notice);
    }
    return fresh;
  }
}

/** 子进程只返回布尔状态；不读取窗口标题，不把进程详情送进通知。 */
function readForeground() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(executable, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'foreground-codex.ps1'),
    ], { windowsHide: true, timeout: 4000, maxBuffer: 16384, encoding: 'utf8' }, (error, stdout) => {
      if (error) return reject(new Error('foreground-check-failed'));
      try {
        resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim()));
      } catch {
        reject(new Error('foreground-check-failed'));
      }
    });
  });
}

/** 可注入依赖用于验证通知分支；生产入口 install 使用真实 Electron 和前台探测。 */
function createController({ hostRequest, electron, checkForeground = readForeground, log = console.warn, beforeStart = () => {}, locale = Locale.getLocale() }) {
  if (typeof hostRequest !== 'function') throw new TypeError('hostRequest is required');
  const { app, Notification, shell } = electron;
  const history = new NoticeHistory();
  const logged = new Set();
  const active = new Set();
  let timer = null;
  let stopped = false;
  let inFlight = false;

  const logOnce = (key, message, values = {}) => {
    if (logged.has(key)) return;
    logged.add(key);
    log(`[Codex Pet] ${Locale.t(message, values, locale)}`);
  };

  const poll = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const response = await hostRequest('GET', NOTICE_PATH);
      if (stopped) return;
      if (!response || response.status < 200 || response.status >= 300) throw new Error('notice-read-failed');
      const payload = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      const notices = history.take(payload?.notices);
      if (!notices.length) return;
      if (!Notification.isSupported()) {
        logOnce('unsupported', '系统通知不可用。');
        return;
      }
      let foreground;
      try {
        foreground = await checkForeground();
      } catch {
        logOnce('foreground', '前台状态检查失败，本次不显示通知。');
        return;
      }
      if (stopped) return;
      const decision = notificationDecision(foreground);
      if (decision === 'error') logOnce('foreground', '前台状态检查失败，本次不显示通知。');
      if (decision !== 'notify') return;
      for (const notice of notices) {
        try {
          const notification = new Notification({ title: notice.title, body: notice.body });
          active.add(notification);
          const release = () => active.delete(notification);
          notification.once('close', release);
          notification.once('failed', (event, error) => {
            release();
            const code = nativeErrorCode(error || event);
            logOnce(`show:${code}`, '系统通知显示失败（{code}）。', { code });
          });
          notification.once('show', () => logOnce('shown', '系统通知已提交。'));
          notification.once('click', () => {
            release();
            const url = threadUrl(notice, foreground.protocolRegistered);
            if (!url) {
              logOnce('protocol', 'Codex 跳转不可用，已保留系统通知。');
              return;
            }
            Promise.resolve().then(() => shell.openExternal(url)).catch(() => {
              logOnce('open', '无法打开对应 Codex 对话。');
            });
          });
          notification.show();
          // 通知中心可能长时间不发 close，不能无界持有 Native 对象。
          while (active.size > 32) {
            const oldest = active.values().next().value;
            active.delete(oldest);
            oldest.close();
          }
        } catch (error) {
          const code = nativeErrorCode(error);
          logOnce(`show:${code}`, '系统通知显示失败（{code}）。', { code });
        }
      }
    } catch {
      if (!stopped) logOnce('read', '通知状态读取失败。');
    } finally {
      inFlight = false;
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    for (const notification of active) {
      try { notification.close(); } catch { /* 退出时通知可能已经由系统关闭。 */ }
    }
    active.clear();
    app.removeListener('before-quit', stop);
  };
  const start = () => {
    if (stopped || timer !== null) return;
    try { beforeStart(); } catch { logOnce('shortcut', '通知快捷方式创建失败。'); }
    timer = setInterval(() => { void poll(); }, 1500);
    timer.unref?.();
    void poll();
  };
  app.once('before-quit', stop);
  if (app.isReady()) start();
  else app.whenReady().then(start).catch(() => logOnce('ready', '通知入口未能启动。'));
  return { stop, poll };
}

function install({ hostRequest: _hostRequest }) {
  const electron = require('electron');
  // 系统通知按应用名展示，避免原始 Electron 运行时名称混淆来源。
  electron.app.setName('Codex Pet');
  if (process.platform === 'win32') {
    // 与启动器创建的开始菜单快捷方式保持同一身份。
    electron.app.setAppUserModelId(APP_USER_MODEL_ID);
  }
  // bridge 的 hostRequest 绕过独立模式 HTTP 路由；通知必须走实际端口上的本机扩展入口。
  return createController({
    hostRequest: createNoticeRequest(process.env.CODEX_PET_NOTICE_URL),
    electron,
    beforeStart: () => ensureShortcut(electron, process.env.CODEX_PET_LAUNCHER, console.warn),
  });
}

module.exports = {
  APP_USER_MODEL_ID, install, createController, createNoticeRequest, noticeUrl,
  normalizeNotice, notificationDecision, nativeErrorCode, threadUrl, NoticeHistory,
  isOwnedShortcut, ensureShortcut,
};
