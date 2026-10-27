[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$AppRoot)

$ErrorActionPreference = 'Stop'
if (-not $AppRoot) { $AppRoot = Split-Path -Parent $PSScriptRoot }
$taskRoot = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\', '/')
$taskStartup = [Environment]::GetFolderPath('Startup')
$taskShortcut = if ($taskStartup) { Join-Path $taskStartup 'dsh-pet-codex-follow.lnk' } else { $null }
$taskRemoved = $false
if ($taskShortcut -and (Test-Path -LiteralPath $taskShortcut)) {
    $taskShell = New-Object -ComObject WScript.Shell
    $taskLink = $taskShell.CreateShortcut($taskShortcut)
    $taskVbs = Join-Path $taskRoot 'scripts/follow-codex.vbs'
    $taskOwned = $taskLink.Description -eq 'dsh-pet-codex follow Codex startup' -and $taskLink.Arguments.IndexOf(('"' + $taskVbs + '"'), [StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($taskOwned -and $PSCmdlet.ShouldProcess($taskShortcut, '移除本安装目录的跟随启动项')) {
        Remove-Item -LiteralPath $taskShortcut
        $taskRemoved = $true
    }
}

$taskHasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $taskBytes = [System.Text.Encoding]::UTF8.GetBytes($taskRoot.ToLowerInvariant())
    $taskKey = ([System.BitConverter]::ToString($taskHasher.ComputeHash($taskBytes))).Replace('-', '').Substring(0, 24)
} finally { $taskHasher.Dispose() }
$taskStop = $null
$taskMutex = $null
$taskStopped = $false
try {
    try { $taskStop = [System.Threading.EventWaitHandle]::OpenExisting("Local\dsh-pet-codex-follow-stop-$taskKey") }
    catch [System.Threading.WaitHandleCannotBeOpenedException] { $taskStopped = $true }
    if ($taskStop -and $PSCmdlet.ShouldProcess($taskRoot, '停止本安装目录的跟随监控器')) {
        # 只发给本目录派生的退出事件；不按进程名杀进程，也不结束Codex或宠物。
        $taskStop.Set() | Out-Null
        try { $taskMutex = [System.Threading.Mutex]::OpenExisting("Local\dsh-pet-codex-follow-$taskKey") }
        catch [System.Threading.WaitHandleCannotBeOpenedException] { $taskStopped = $true }
        if ($taskMutex) {
            try { $taskStopped = $taskMutex.WaitOne(10000) }
            catch [System.Threading.AbandonedMutexException] { $taskStopped = $true }
            if ($taskStopped) { $taskMutex.ReleaseMutex() }
            else { throw '已发送退出信号，但监控器尚未退出，请稍后重试。' }
        }
    }
} finally {
    if ($taskMutex) { $taskMutex.Dispose() }
    if ($taskStop) { $taskStop.Dispose() }
}
[ordered]@{ disabled = (-not $WhatIfPreference); shortcutRemoved = $taskRemoved; watcherStopped = $taskStopped } | ConvertTo-Json -Compress
