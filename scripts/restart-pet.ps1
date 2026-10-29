[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$AppRoot,[Parameter(Mandatory=$true)][int]$ExpectedPid,[Parameter(Mandatory=$true)][string]$ReadyFile)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\','/')
$taskEntry = Join-Path $taskRoot 'src/app.mjs'
if (-not (Test-Path -LiteralPath $taskEntry -PathType Leaf)) { throw 'Pet entry is missing.' }
$taskProcess = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $ExpectedPid) -ErrorAction SilentlyContinue
if ($taskProcess -and (([string]$taskProcess.CommandLine).Replace('/','\').IndexOf($taskEntry.Replace('/','\'),[StringComparison]::OrdinalIgnoreCase) -lt 0)) { throw 'Pet process identity mismatch.' }
$taskData = Join-Path $taskRoot 'data'
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ReadyFile)) -ine $taskData -or [IO.Path]::GetFileName($ReadyFile) -notmatch '^host-restart-ready-[a-f0-9-]{36}\.json$') { throw 'Invalid restart handshake path.' }
$taskReady = & (Join-Path $taskRoot 'start.ps1') -AppRoot $taskRoot -NoStart | ConvertFrom-Json
if (-not $taskReady.nodeAvailable -or -not $taskReady.runtimeReady) { throw 'Pet runtime is not ready.' }
$taskReadyTemp = $ReadyFile + '.tmp'
[IO.File]::WriteAllText($taskReadyTemp,(@{schemaVersion=1;pid=$PID;expectedPid=$ExpectedPid}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
[IO.File]::Move($taskReadyTemp,$ReadyFile)
# 旧宿主收到成功响应后自行释放监听、窗口和锁；这里只等，不按进程名杀任何应用。
if ($taskProcess) {
    try { Wait-Process -Id $ExpectedPid -Timeout 20 -ErrorAction Stop }
    catch { if (Get-Process -Id $ExpectedPid -ErrorAction SilentlyContinue) { throw } }
}
& (Join-Path $taskRoot 'start.ps1') -AppRoot $taskRoot
