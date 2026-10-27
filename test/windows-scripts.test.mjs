import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const powershell = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const windowsOnly = { skip: process.platform !== 'win32' };

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
