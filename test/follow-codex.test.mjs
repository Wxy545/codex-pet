import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, mkdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

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
  const files = ['install.ps1', 'start.ps1', 'stop.ps1', 'setup.ps1', 'scripts/locale.ps1', 'scripts/follow-codex.ps1', 'scripts/enable-follow.ps1', 'scripts/disable-follow.ps1'];
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

test('跟随读取当前宿主选择，WorkBuddy必须同时匹配程序、产品与发行方', windowsOnly, async t => {
  const folder = await temporaryRoot(t); await writeFile(join(folder, 'start.ps1'), "\uFEFFparam([string]$AppRoot)\nthrow 'must-not-start'\n");
  await mkdir(join(folder, 'data')); await writeFile(join(folder, 'data/host.json'), JSON.stringify({ schemaVersion: 1, host: 'workbuddy' }));
  for (const [name, product, company, expected] of [
    ['WorkBuddy.exe', 'WorkBuddy', 'Tencent Technology (Shenzhen) Company Limited', true],
    ['WorkBuddy.exe', 'WorkBuddy', 'Other', false],
    ['WorkBuddy.exe', 'Other', 'Tencent Technology (Shenzhen) Company Limited', false],
    ['ChatGPT.exe', 'WorkBuddy', 'Tencent Technology (Shenzhen) Company Limited', false],
  ]) {
    const command = "function global:Get-Process { [CmdletBinding()]param([string]$Name); [pscustomobject]@{Path=" + psQuote('C:/fake/' + name) + ';Product=' + psQuote(product) + ';Company=' + psQuote(company) + "} }; & " + psQuote(follow) + ' -AppRoot ' + psQuote(folder) + ' -Once -NoStart';
    const probe = JSON.parse((await runPs(command)).stdout.trim()); assert.equal(probe.host, 'workbuddy'); assert.equal(probe.hostRunning, expected); assert.equal(probe.workbuddyRunning, expected); assert.equal(probe.codexRunning, false); assert.equal(probe.startRequested, false);
  }
  await assert.rejects(access(join(folder, 'data/app.log')));
});

test('一个watcher切换宿主后只投递对应启动边沿，不另建第二个监控器', windowsOnly, async t => {
  const folder = await temporaryRoot(t); await mkdir(join(folder, 'data')); await writeFile(join(folder, 'data/host.json'), JSON.stringify({ schemaVersion: 1, host: 'workbuddy' }));
  await writeFile(join(folder, 'start.ps1'), '\uFEFF' + [
    'param([string]$AppRoot,[string]$Reason)',
    "[IO.File]::AppendAllText((Join-Path $AppRoot 'reasons.txt'),$Reason+[Environment]::NewLine)",
    "if($Reason -eq 'workbuddy') { [IO.File]::WriteAllText((Join-Path $AppRoot 'data/host.json'),'{\"schemaVersion\":1,\"host\":\"codex\"}'); return }",
    '$taskHasher=[Security.Cryptography.SHA256]::Create()',
    "try{$taskKey=([BitConverter]::ToString($taskHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($AppRoot.ToLowerInvariant())))).Replace('-','').Substring(0,24)}finally{$taskHasher.Dispose()}",
    '$taskStop=[Threading.EventWaitHandle]::OpenExisting("Local\\dsh-pet-codex-follow-stop-$taskKey")',
    'try{$taskStop.Set() | Out-Null}finally{$taskStop.Dispose()}',
  ].join('\n'));
  const command = "function global:Get-Process { [CmdletBinding()]param([string]$Name); if($Name -eq 'WorkBuddy'){[pscustomobject]@{Path='C:/fake/WorkBuddy.exe';Product='WorkBuddy';Company='Tencent Technology (Shenzhen) Company Limited'}}else{[pscustomobject]@{Path=" + psQuote(fakeCodexPath) + "}} }; & " + psQuote(follow) + ' -AppRoot ' + psQuote(folder) + ' -PollSeconds 1';
  const probes = (await runPs(command)).stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.deepEqual((await readFile(join(folder, 'reasons.txt'), 'utf8')).trim().split(/\r?\n/), ['workbuddy', 'codex']); assert.deepEqual(probes.map(value => value.host), ['workbuddy', 'codex']); assert.ok(probes.every(value => value.startRequested));
});

test('跟随只在Codex启动边沿调用start，重复实例被拒绝，退出信号结束自己的监控器', windowsOnly, async t => {
  const folder = await temporaryRoot(t);
  const stub = '\uFEFF' + [
    'param([string]$AppRoot,[string]$Reason)',
    "$taskCountFile=Join-Path $AppRoot 'starts.txt'",
    '$taskCount=if(Test-Path -LiteralPath $taskCountFile){[int](Get-Content -LiteralPath $taskCountFile)}else{0}',
    '$taskCount++',
    '[IO.File]::WriteAllText($taskCountFile,[string]$taskCount)',
    "[IO.File]::AppendAllText((Join-Path $AppRoot 'reasons.txt'),$Reason+[Environment]::NewLine)",
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
  assert.deepEqual((await readFile(join(folder,'reasons.txt'),'utf8')).trim().split(/\r?\n/),['codex','codex']);
  assert.equal(output.length, 2);
  assert.ok(output.every(probe => probe.startRequested));
  const second = JSON.parse(await readFile(join(folder, 'second-instance.txt'), 'utf8').then(text => text.replace(/^\uFEFF/, '')));
  assert.equal(second.alreadyWatching, true);
});

test('运行中桌宠接到新Codex启动只投递认证事件，不重复启动Node',windowsOnly,async t=>{
 const folder=await temporaryRoot(t),token='x'.repeat(43),requests=[];
 await mkdir(join(folder,'src'),{recursive:true});await writeFile(join(folder,'src/app.mjs'),'throw new Error("must-not-start")');
 await mkdir(join(folder,'node_modules/dsh-pet/lib'),{recursive:true});await writeFile(join(folder,'node_modules/dsh-pet/lib/codex-host.js'),'');
 const server=createServer(async(req,res)=>{if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({name:'codex-pet',pid:43123}));return;}let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,method:req.method,token:req.headers['x-dsh-pet-token'],body});res.setHeader('Content-Type','application/json');res.end('{"ok":true}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 await mkdir(join(folder,'data/dsh-pet'),{recursive:true});await writeFile(join(folder,'data/dsh-pet/standalone-runtime.json'),JSON.stringify({port:server.address().port,pid:43123,token}));
 await runPs('& '+psQuote(join(root,'start.ps1'))+' -AppRoot '+psQuote(folder)+' -Reason codex');
 assert.deepEqual(requests,[{url:'/dsh-pet-7340/codex-startup',method:'POST',token,body:'{"reason":"codex"}'}]);
 await assert.rejects(access(join(folder,'data/app.log')));
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
