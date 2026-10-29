'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const W = require('./workbuddy-notifications.cjs');

const notice = { id: 'wb-one', source: 'workbuddy', title: 'Task complete', body: 'Ready to review', threadId: '00000000-0000-4000-8000-000000000001' };
function fixture(state, options = {}) {
  const app = new EventEmitter(); app.isReady = () => false; app.whenReady = () => new Promise(() => {});
  const shown = [], external = [], activated = [], logs = [];
  class Notification extends EventEmitter { static isSupported() { return true; } constructor(value) { super(); this.value = value; } show() { shown.push(this); } close() { this.emit('close'); } }
  const controller = W.createController({
    electron: { app, Notification, shell: { openExternal: async value => external.push(value) } }, locale: 'en',
    hostRequest: async () => ({ status: 200, body: { notices: options.notices || [notice, { ...notice, id: 'codex-one', source: 'codex' }] } }),
    checkForeground: async () => state,
    activateTarget: async action => { activated.push(action); return { ok: true, ready: true, focused: options.focused !== false }; },
    log: value => logs.push(value),
  });
  return { controller, shown, external, activated, logs };
}

test('WorkBuddy通知只接明确来源，移除未核实的会话ID，不接受任意deep link', () => {
  assert.equal(W.normalizeNotice({ ...notice, source: 'codex' }), null); assert.equal(W.normalizeNotice({ ...notice, source: undefined }), null);
  const normalized = W.normalizeNotice({ ...notice, url: 'codex://threads/private', token: 'private' });
  assert.equal(normalized.source, 'workbuddy'); assert.equal(normalized.threadId, null); assert.equal(normalized.url, undefined); assert.equal(normalized.token, undefined);
});

test('WorkBuddy在前台或状态未知不提示，后台去重并仅激活WorkBuddy', async () => {
  for (const state of [{ ok: true, isWorkBuddyForeground: true }, { ok: false }, { ok: true, isCodexForeground: false }]) {
    const f = fixture(state); await f.controller.poll(); assert.equal(f.shown.length, 0); f.controller.stop();
  }
  const f = fixture({ ok: true, isWorkBuddyForeground: false }); await f.controller.poll(); await f.controller.poll(); assert.equal(f.shown.length, 1);
  assert.deepEqual(f.shown[0].value, { title: 'Task complete', body: 'Ready to review' }); f.shown[0].emit('click'); await new Promise(setImmediate);
  assert.deepEqual(f.activated, ['focus']); assert.deepEqual(f.external, []); f.controller.stop();
});

test('WorkBuddy激活失败不回退到Codex或泄露内容', async () => {
  const f = fixture({ ok: true, isWorkBuddyForeground: false }, { focused: false }); await f.controller.poll(); f.shown[0].emit('click'); await new Promise(setImmediate);
  assert.equal(f.logs.some(value => value.includes('Task complete')), false); assert.deepEqual(f.external, []); f.controller.stop();
});

test('WorkBuddy前台helper仅传回受控布尔字段，隐藏运行、超时有界', async () => {
  let captured;
  const value = await W.readForeground({ platform: 'win32', execFileImpl: (file, args, options, callback) => { captured = { file, args, options }; callback(null, JSON.stringify({ ok: true, isWorkBuddyForeground: false, title: 'private', path: 'private' })); } });
  assert.deepEqual(value, { ok: true, isWorkBuddyForeground: false }); assert.equal(path.basename(captured.args.at(-1)), 'foreground-workbuddy.ps1'); assert.equal(captured.options.windowsHide, true); assert.equal(captured.options.timeout, 2500);
  assert.deepEqual(await W.readForeground({ platform: 'linux' }), { ok: false, isWorkBuddyForeground: false });
  assert.deepEqual(await W.readForeground({ platform: 'win32', execFileImpl: (_file, _args, _options, callback) => callback(null, '{"ok":true}') }), { ok: false, isWorkBuddyForeground: false });
});

test('WorkBuddy原生脚本为WinPS5可解析BOM，仅用进程指纹和窗口几何', { skip: process.platform !== 'win32' }, () => {
  const files = ['workbuddy-target.ps1', 'foreground-workbuddy.ps1'].map(file => path.join(__dirname, file));
  for (const file of files) assert.equal(readFileSync(file).subarray(0, 3).toString('hex'), 'efbbbf');
  const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = "$ErrorActionPreference='Stop'; foreach($taskFile in @(" + files.map(psQuote).join(',') + ")){$taskTokens=$null;$taskErrors=$null;[Management.Automation.Language.Parser]::ParseFile($taskFile,[ref]$taskTokens,[ref]$taskErrors)|Out-Null;if($taskErrors.Count){throw 'parse-failed'}};" +
    "$taskAst=[Management.Automation.Language.Parser]::ParseFile(" + psQuote(files[0]) + ",[ref]$taskTokens,[ref]$taskErrors);$taskFn=$taskAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-WorkBuddyProcess'},$true);Invoke-Expression $taskFn.Extent.Text;" +
    "$taskValues=@([pscustomobject]@{Path='D:/app/WorkBuddy.exe';Product='WorkBuddy';Company='Tencent Technology (Shenzhen) Company Limited'},[pscustomobject]@{Path='D:/fake/WorkBuddy.exe';Product='Other';Company='Other'},[pscustomobject]@{Path='D:/fake/ChatGPT.exe';Product='WorkBuddy';Company='Tencent Technology (Shenzhen) Company Limited'});@($taskValues|ForEach-Object {Test-WorkBuddyProcess $_})|ConvertTo-Json -Compress";
  const stdout = execFileSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 12000 });
  assert.deepEqual(JSON.parse(stdout.trim()), [true, false, false]);
  const source = readFileSync(files[0], 'utf8'); assert.doesNotMatch(source, /GetWindowText|ReadProcessMemory|MainWindowTitle|openExternal/);
});

test('WorkBuddy Alive在加载Win32前只查已核实进程，元数据未知不能假报退出', { skip: process.platform !== 'win32' }, () => {
  const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), script = path.join(__dirname, 'workbuddy-target.ps1').replaceAll("'", "''");
  for (const [value, expected] of [
    ["[pscustomobject]@{Path='D:/app/WorkBuddy.exe';Product='WorkBuddy';Company='Tencent Technology (Shenzhen) Company Limited'}", { ok: true, running: true }],
    ['', { ok: true, running: false }],
    ["[pscustomobject]@{Path='D:/fake/WorkBuddy.exe';Product='Other';Company='Other'}", { ok: true, running: false }],
    ["[pscustomobject]@{Path=$null;Product=$null;Company=$null}", { ok: false, running: false }],
  ]) {
    const command = "function global:Add-Type { throw 'must-not-load-win32' }; function global:Get-Process { [CmdletBinding()]param([string]$Name); " + value + " }; & '" + script + "' -Action Alive";
    const output = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 12000 }); assert.deepEqual(JSON.parse(output.trim()), expected);
  }
});
