'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const Base = require('./codex-notifications.cjs');
const { createTargetRequest } = require('./codex-startup.cjs');

/** 只消费当前宿主的通知；WorkBuddy未核实会话协议，不接收任意深链。 */
function normalizeNotice(value) {
  if(value?.source==='qq')return Base.normalizeNotice(value);
  if (value?.source !== 'workbuddy') return null;
  const notice = Base.normalizeNotice(value);
  return notice ? { ...notice, threadId: null, source: 'workbuddy' } : null;
}

function readForeground({ execFileImpl = execFile, fileRoot = __dirname, platform = process.platform } = {}) {
  if (platform !== 'win32') return Promise.resolve({ ok: false, isWorkBuddyForeground: false });
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise(resolve => {
    execFileImpl(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(fileRoot, 'foreground-workbuddy.ps1')],
      { windowsHide: true, timeout: 2500, maxBuffer: 4096, encoding: 'utf8' }, (error, stdout) => {
        if (error) return resolve({ ok: false, isWorkBuddyForeground: false });
        try {
          const value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
          resolve({ ok: value.ok === true && typeof value.isWorkBuddyForeground === 'boolean', isWorkBuddyForeground: value.isWorkBuddyForeground === true });
        } catch { resolve({ ok: false, isWorkBuddyForeground: false }); }
      });
  });
}

function createController({ hostRequest, checkForeground = readForeground, activateTarget = createTargetRequest({ host: 'workbuddy' }), ...options }) {
  if (typeof hostRequest !== 'function') throw new TypeError('hostRequest is required');
  return Base.createController({
    ...options,
    hostRequest: async (...args) => {
      const response = await hostRequest(...args);
      if (!response || response.status < 200 || response.status >= 300) return response;
      const payload = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      const notices = (Array.isArray(payload?.notices) ? payload.notices.slice(0, 100) : []).map(normalizeNotice).filter(Boolean);
      return { ...response, body: { notices } };
    },
    checkForeground: async () => {
      const value = await checkForeground();
      return { ok: value?.ok === true && typeof value.isWorkBuddyForeground === 'boolean', isCodexForeground: value?.isWorkBuddyForeground === true, protocolRegistered: false };
    },
    activateNotice: async () => {
      // 激活前由helper重新核对进程身份；不构造未经验证的WorkBuddy或Codex URL。
      const result = await activateTarget('focus');
      if (result?.focused !== true) throw new Error('workbuddy-activation-failed');
    },
  });
}

function install({openQQ}={}) {
  const electron = require('electron');
  electron.app.setName('Codex Pet');
  if (process.platform === 'win32') electron.app.setAppUserModelId(Base.APP_USER_MODEL_ID);
  return createController({
    electron,
    openQQ,
    hostRequest: Base.createNoticeRequest(process.env.CODEX_PET_NOTICE_URL),
    beforeStart: () => Base.ensureShortcut(electron, process.env.CODEX_PET_LAUNCHER, console.warn),
  });
}

module.exports = { install, createController, normalizeNotice, readForeground };
