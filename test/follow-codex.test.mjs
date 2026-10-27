import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, mkdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const powershell = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const follow = join(root, 'scripts/follow-codex.ps1');
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
const windowsOnly = { skip: process.platform !== 'win32' };

async function temporaryRoot(t) {
  const folder = await mkdtemp(join(tmpdir(), 'codex-follow-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
async function runPs(command, timeout = 12000) {
  return execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, shell: false, timeout });
}
const fakeCodexPath = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0.0_x64__test\\app\\ChatGPT.exe';

test('Windows脚本均为UTF8 BOM，Windows PowerShell 5可解析', windowsOnly, async () => {
  const files = ['start.ps1', 'scripts/follow-codex.ps1', 'scripts/enable-follow.ps1', 'scripts/disable-follow.ps1'];
  for (const file of files) assert.equal((await readFile(join(root, file))).subarray(0, 3).toString('hex'), 'efbbbf');
  const command = "$ErrorActionPreference='Stop'; foreach($taskFile in @(" + files.map(file => psQuote(join(root, file))).join(',') + ")) { $taskTokens=$null; $taskErrors=$null; [System.Management.Automation.Language.Parser]::ParseFile($taskFile,[ref]$taskTokens,[ref]$taskErrors) | Out-Null; if($taskErrors.Count){throw 'parse-failed'} }; 'ok'";
  assert.equal((await runPs(command)).stdout.trim(), 'ok');
});

test('WinPS5真实-File入口不传AppRoot仍可只读诊断，启停跟随WhatIf不改Startup', windowsOnly, async () => {
  for (const [file, args] of [
    ['scripts/follow-codex.ps1', ['-Once', '-NoStart']],
    ['start.ps1', ['-NoStart']],
  ]) {
    const result = await execute(powershell, ['-NoProfile', '-NonInteractive', '-File', join(root, file), ...args], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 12000 });
    const probe = JSON.parse(result.stdout.trim());
    assert.equal(typeof (file === 'start.ps1' ? probe.alreadyRunning : probe.codexRunning), 'boolean');
  }
  for (const file of ['scripts/enable-follow.ps1', 'scripts/disable-follow.ps1']) {
    await execute(powershell, ['-NoProfile', '-NonInteractive', '-File', join(root, file), '-WhatIf'], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 12000 });
  }
});

test('只读探测识别Codex UI，忽略普通ChatGPT与CLI，且不触发start或写data', windowsOnly, async t => {
  const folder = await temporaryRoot(t);
  await writeFile(join(folder, 'start.ps1'), "\uFEFFparam([string]$AppRoot)\nthrow 'must-not-start'\n");
  for (const [path, expected] of [[fakeCodexPath, true], ['C:\\NonexistentChatGPT\\ChatGPT.exe', false], ['C:\\Codex\\codex.exe', false]]) {
    const command = "function global:Get-Process { [CmdletBinding()]param([string]$Name); [pscustomobject]@{Path=" + psQuote(path) + "} }; & " + psQuote(follow) + ' -AppRoot ' + psQuote(folder) + ' -Once -NoStart';
    const probe = JSON.parse((await runPs(command)).stdout.trim());
    assert.equal(probe.codexRunning, expected);
    assert.equal(probe.startRequested, false);
  }
  await assert.rejects(access(join(folder, 'data')));
});

test('跟随只在Codex启动边沿调用start，重复实例被拒绝，退出信号结束自己的监控器', windowsOnly, async t => {
  const folder = await temporaryRoot(t);
  const stub = '\uFEFF' + [
    'param([string]$AppRoot)',
    "$taskCountFile=Join-Path $AppRoot 'starts.txt'",
    '$taskCount=if(Test-Path -LiteralPath $taskCountFile){[int](Get-Content -LiteralPath $taskCountFile)}else{0}',
    '$taskCount++',
    '[IO.File]::WriteAllText($taskCountFile,[string]$taskCount)',
    'if($taskCount -eq 1) {',
    '  & ' + psQuote(powershell) + ' -NoProfile -NonInteractive -File ' + psQuote(follow) + " -AppRoot $AppRoot -Once | Set-Content -LiteralPath (Join-Path $AppRoot 'second-instance.txt')",
    '}',
    'if($taskCount -eq 2) {',
    '  $taskHasher=[Security.Cryptography.SHA256]::Create()',
    "  try{$taskKey=([BitConverter]::ToString($taskHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($AppRoot.ToLowerInvariant())))).Replace('-','').Substring(0,24)}finally{$taskHasher.Dispose()}",
    '  $taskStop=[Threading.EventWaitHandle]::OpenExisting("Local\\dsh-pet-codex-follow-stop-$taskKey")',
    '  try{$taskStop.Set() | Out-Null}finally{$taskStop.Dispose()}',
    '}',
  ].join('\n');
  await writeFile(join(folder, 'start.ps1'), stub);
  const command = "$global:petTestPoll=0; function global:Get-Process { [CmdletBinding()]param([string]$Name); $global:petTestPoll++; if($global:petTestPoll -eq 3){return}; [pscustomobject]@{Path=" + psQuote(fakeCodexPath) + "} }; & " + psQuote(follow) + ' -AppRoot ' + psQuote(folder) + ' -PollSeconds 1';
  const output = (await runPs(command)).stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(await readFile(join(folder, 'starts.txt'), 'utf8'), '2');
  assert.equal(output.length, 2);
  assert.ok(output.every(probe => probe.startRequested));
  const second = JSON.parse(await readFile(join(folder, 'second-instance.txt'), 'utf8').then(text => text.replace(/^\uFEFF/, '')));
  assert.equal(second.alreadyWatching, true);
});

test('start的NoStart探测优先便携Node，不改运行数据', windowsOnly, async t => {
  const folder = await temporaryRoot(t);
  await mkdir(join(folder, 'data/runtime/node'), { recursive: true });
  await mkdir(join(folder, 'node_modules/dsh-pet/lib'), { recursive: true });
  await writeFile(join(folder, 'data/runtime/node/node.exe'), '');
  await writeFile(join(folder, 'node_modules/dsh-pet/lib/codex-host.js'), '');
  const result = await runPs('& ' + psQuote(join(root, 'start.ps1')) + ' -AppRoot ' + psQuote(folder) + ' -NoStart');
  const probe = JSON.parse(result.stdout.trim());
  assert.equal(probe.nodeAvailable, true);
  assert.equal(probe.portableNode, true);
  assert.equal(probe.runtimeReady, true);
  assert.equal(probe.alreadyRunning, false);
  assert.equal(probe.wouldStart, true);
  await assert.rejects(access(join(folder, 'data/app.log')));
});
