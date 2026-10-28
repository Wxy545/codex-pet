import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const powershell = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const windowsOnly = { skip: process.platform !== 'win32' };
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
function runPs(script, env = {}) {
  return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " + script], {
    env: { ...process.env, PET_SCRIPT_ROOT: root, ...env }, encoding: 'utf8', windowsHide: true, timeout: 20000,
  }).trim();
}

test('Windows显示语言zh系列用中文，其余语言用英文，辅助函数不改系统语言', windowsOnly, () => {
  const script = `$original=[Globalization.CultureInfo]::CurrentUICulture.Name; . (Join-Path $env:PET_SCRIPT_ROOT 'scripts/locale.ps1'); $items=@(); foreach($name in @('zh-CN','zh-TW','en-US','ja-JP')) { $global:petTestCulture=$name; function global:Get-UICulture { [Globalization.CultureInfo]::GetCultureInfo($global:petTestCulture) }; $items+=Get-CodexPetText '中文' 'English' }; @{items=$items;unchanged=([Globalization.CultureInfo]::CurrentUICulture.Name -eq $original)} | ConvertTo-Json -Compress`;
  const result = JSON.parse(runPs(script));
  assert.deepEqual(result.items, ['中文', '中文', 'English', 'English']);
  assert.equal(result.unchanged, true);
});

test('新安装默认codex-pet，有旧默认安装时不迁移也不另起安装', windowsOnly, () => {
  const folder = mkdtempSync(join(tmpdir(), 'codex-pet-install-legacy-'));
  try {
    const script = `$ErrorActionPreference='Stop'; $env:LOCALAPPDATA=${psQuote(folder)}; New-Item -ItemType Directory -Path (Join-Path $env:LOCALAPPDATA 'dsh-pet-codex') | Out-Null; function global:Invoke-RestMethod { throw 'NETWORK_MUST_NOT_RUN' }; try { & (Join-Path $env:PET_SCRIPT_ROOT 'install.ps1') -NoStart -NoFollow; throw 'INSTALL_SHOULD_REFUSE' } catch { @{message=$_.Exception.Message;newCreated=(Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'codex-pet'));oldExists=(Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'dsh-pet-codex'))} | ConvertTo-Json -Compress }`;
    const result = JSON.parse(runPs(script));
    assert.doesNotMatch(result.message, /NETWORK_MUST_NOT_RUN|INSTALL_SHOULD_REFUSE/);
    assert.match(result.message, /dsh-pet-codex/);
    assert.equal(result.newCreated, false); assert.equal(result.oldExists, true);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('无旧安装时实际解析的新默认目录和GitHub请求都使用codex-pet', windowsOnly, () => {
  const folder = mkdtempSync(join(tmpdir(), 'codex-pet-install-new-'));
  try {
    const script = `$ErrorActionPreference='Stop'; $env:LOCALAPPDATA=${psQuote(folder)}; function global:Invoke-RestMethod { param($Uri); throw ('NETWORK_BLOCKED_URI='+$Uri) }; try { . (Join-Path $env:PET_SCRIPT_ROOT 'install.ps1') -NoStart -NoFollow 6>$null } catch { @{target=$installerTarget;repo=$installerRepo;message=$_.Exception.Message} | ConvertTo-Json -Compress }`;
    const result = JSON.parse(runPs(script));
    // CI的TEMP可能是8.3短路径；比较同一目录的规范路径，不能把长短名称当成安装目录错误。
    assert.equal(result.target.toLowerCase(), join(realpathSync.native(folder), 'codex-pet').toLowerCase());
    assert.equal(result.repo, 'Wxy545/codex-pet');
    assert.match(result.message, /https:\/\/api\.github\.com\/repos\/Wxy545\/codex-pet\/git\/ref\/heads\/main/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('启动健康探测只接受新旧项目名及匹配PID，拒绝无关服务', windowsOnly, () => {
  const folder = mkdtempSync(join(tmpdir(), 'codex-pet-health-'));
  try {
    const script = `$ErrorActionPreference='Stop'; $folder=${psQuote(folder)}; New-Item -ItemType Directory -Path (Join-Path $folder 'data/dsh-pet') -Force | Out-Null; @{port=12345;pid=98765} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'data/dsh-pet/standalone-runtime.json'); function global:Get-CimInstance { @() }; function global:Invoke-RestMethod { @{name=$global:petTestName;pid=$global:petTestPid} }; function global:Invoke-WebRequest { [pscustomobject]@{StatusCode=200;Content='{}'} }; $items=@(); foreach($name in @('codex-pet','dsh-pet-codex','unrelated')) { $global:petTestName=$name; $global:petTestPid=98765; $items+=(& (Join-Path $env:PET_SCRIPT_ROOT 'start.ps1') -AppRoot $folder -NoStart | ConvertFrom-Json).alreadyRunning }; $global:petTestName='codex-pet';$global:petTestPid=111; $items+=(& (Join-Path $env:PET_SCRIPT_ROOT 'start.ps1') -AppRoot $folder -NoStart | ConvertFrom-Json).alreadyRunning; ConvertTo-Json -InputObject $items -Compress`;
    assert.deepEqual(JSON.parse(runPs(script)), [true, true, false, false]);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('独立下载的安装器无需辅助文件也能输出英文拒绝覆盖信息', windowsOnly, () => {
  const folder = mkdtempSync(join(tmpdir(), 'codex-pet-installer-locale-'));
  try {
    const installer = join(folder, 'install.ps1'); writeFileSync(installer, readFileSync(resolve(root, 'install.ps1')));
    const output = runPs(`$ErrorActionPreference='Stop'; function global:Get-UICulture { [Globalization.CultureInfo]::GetCultureInfo('en-US') }; try { & ${psQuote(installer)} -InstallDir ${psQuote(folder)} -NoStart -NoFollow } catch { $_.Exception.Message }`);
    assert.match(output, /already exists/i); assert.doesNotMatch(output, /安装目录已存在/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('安装就绪检测同时接受新旧健康名称，但必须匹配PID及本目录Electron子进程', windowsOnly, () => {
  const folder = mkdtempSync(join(tmpdir(), 'codex-pet-ready-'));
  try {
    const script = `$ErrorActionPreference='Stop'; . (Join-Path $env:PET_SCRIPT_ROOT 'scripts/locale.ps1'); $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $env:PET_SCRIPT_ROOT 'install.ps1'),[ref]$null,[ref]$null); $fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-PetReady'},$true); . ([scriptblock]::Create($fn.Extent.Text)); $folder=${psQuote(folder)}; New-Item -ItemType Directory -Path (Join-Path $folder 'data/dsh-pet') -Force | Out-Null; @{port=12345;pid=98765} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'data/dsh-pet/standalone-runtime.json'); function global:Invoke-RestMethod { @{name=$global:petTestName;pid=$global:petTestPid} }; function global:Get-CimInstance { [pscustomobject]@{CommandLine=$global:petTestHelper} }; function global:Start-Sleep { throw 'WAIT_WOULD_REPEAT' }; $global:petTestHelper=Join-Path $folder 'node_modules/dsh-pet/runtime/electron-helper/main.js'; $items=@(); foreach($name in @('codex-pet','dsh-pet-codex','unrelated')) { $global:petTestName=$name;$global:petTestPid=98765; try { Wait-PetReady $folder 6>$null; $items+=$true } catch { $items+=$false } }; $global:petTestName='codex-pet';$global:petTestPid=111; try { Wait-PetReady $folder 6>$null;$items+=$true } catch { $items+=$false }; $global:petTestPid=98765;$global:petTestHelper='C:\\Other\\main.js';try { Wait-PetReady $folder 6>$null;$items+=$true } catch { $items+=$false }; ConvertTo-Json -InputObject $items -Compress`;
    assert.deepEqual(JSON.parse(runPs(script)), [true, true, false, false, false]);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('安装器固定提交的zip和解压目录跟随新仓库名，不进入实际安装阶段', windowsOnly, () => {
  const folder = mkdtempSync(join(tmpdir(), 'codex-pet-download-mock-'));
  try {
    const script = `$ErrorActionPreference='Stop';$env:LOCALAPPDATA=${psQuote(folder)};function global:Get-UICulture { [Globalization.CultureInfo]::GetCultureInfo('en-US') };$global:petTestUrls=@();function global:Invoke-RestMethod { param($Uri);$global:petTestUrls+=$Uri;@{object=@{sha=('a'*40)}} };function global:Invoke-WebRequest { param($Uri,$OutFile);$global:petTestUrls+=$Uri;[IO.File]::WriteAllText($OutFile,'fake zip') };function global:Expand-Archive { param($LiteralPath,$DestinationPath);$stage=Join-Path $DestinationPath ('codex-pet-'+('a'*40));New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null;[IO.File]::WriteAllText((Join-Path $stage 'package.json'),'{}');[IO.File]::WriteAllText((Join-Path $stage 'scripts/prepare-runtime.mjs'),''); };try { . (Join-Path $env:PET_SCRIPT_ROOT 'install.ps1') -NoStart -NoFollow 6>$null } catch { @{urls=$global:petTestUrls;stage=$appStage;message=$_.Exception.Message} | ConvertTo-Json -Compress }`;
    const result = JSON.parse(runPs(script));
    assert.equal(result.urls[1], 'https://github.com/Wxy545/codex-pet/archive/' + 'a'.repeat(40) + '.zip');
    assert.match(result.stage, /codex-pet-a{40}$/);
    assert.match(result.message, /expected project files/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('英文启动器由真实VBScript解析，隐藏运行正确的WinPS5入口，不启动桌宠', windowsOnly, () => {
  const folder = mkdtempSync(join(tmpdir(), 'codex-pet-vbs-'));
  try {
    for (const [name, target] of [['Start Codex Pet.vbs', 'start.ps1'], ['Stop Codex Pet.vbs', 'stop.ps1']]) {
      const source = readFileSync(resolve(root, name), 'utf8').replace(/^Option Explicit\s*/i, '').replace('CreateObject("WScript.Shell")', 'New TestShell');
      const script = 'Option Explicit\r\nClass TestShell\r\nPublic Function ExpandEnvironmentStrings(value)\r\nExpandEnvironmentStrings="C:\\Windows"\r\nEnd Function\r\nPublic Sub Run(command, style, wait)\r\nIf style <> 0 Or wait <> False Then Err.Raise 5\r\nWScript.Echo command\r\nEnd Sub\r\nEnd Class\r\n' + source;
      const file = join(folder, name); writeFileSync(file, script);
      const output = execFileSync(join(process.env.SystemRoot || 'C:/Windows', 'System32/cscript.exe'), ['//NoLogo', file], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
      assert.ok(output.startsWith('"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"'));
      assert.ok(output.endsWith(' -File "' + join(folder, target) + '"'));
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('PATH 中有多个 Node 时启动入口只选择首个可执行文件', windowsOnly, () => {
  const script = `function global:Get-Command { [CmdletBinding()]param([string]$Name,[string]$CommandType); @([pscustomobject]@{Source='C:\\First\\node.exe'},[pscustomobject]@{Source='C:\\Second\\node.exe'}) }; & (Join-Path $env:PET_SCRIPT_ROOT 'start.ps1') -NoStart`;
  const result = JSON.parse(execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, PET_SCRIPT_ROOT: root }, encoding: 'utf8', windowsHide: true, timeout: 20000,
  }).trim());
  assert.equal(result.nodeAvailable, true);
  assert.equal(result.portableNode, false);
});

test('所有 PowerShell 入口可由 Windows PowerShell 5.1 解析', windowsOnly, () => {
  const script = `$ErrorActionPreference='Stop'; $count=0; Get-ChildItem -LiteralPath $env:PET_SCRIPT_ROOT -Recurse -Filter *.ps1 | Where-Object { $_.FullName -notmatch '[\\\\/](node_modules|data)[\\\\/]' } | ForEach-Object { $errors=$null; [Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$null,[ref]$errors) | Out-Null; if($errors.Count){ throw ($_.FullName + ': ' + ($errors | Out-String)) }; $count++ }; if($count -lt 4){throw '未找到预期脚本'}`;
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, PET_SCRIPT_ROOT: root }, windowsHide: true, timeout: 20000,
  });
});

test('安装器拒绝覆盖已有目录并保留其中的文件', windowsOnly, () => {
  const directory = mkdtempSync(join(tmpdir(), 'pet-install-existing-'));
  const sentinel = join(directory, 'user-file.txt');
  writeFileSync(sentinel, '保留已有文件');
  try {
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve(root, 'install.ps1'), '-InstallDir', directory, '-NoStart', '-NoFollow'], { windowsHide: true, timeout: 20000 });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(sentinel, 'utf8'), '保留已有文件');
    assert.match(result.stderr.toString(), /install\.ps1|InstallDir|安装目录/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
