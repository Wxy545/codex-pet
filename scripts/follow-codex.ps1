[CmdletBinding()]
param(
    [string]$AppRoot,
    [ValidateRange(1, 300)][int]$PollSeconds = 5,
    [ValidateSet('auto', 'codex', 'workbuddy')][string]$PetHost = 'auto',
    [switch]$Once,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'locale.ps1')
if (-not $AppRoot) { $AppRoot = Split-Path -Parent $PSScriptRoot }
$taskRoot = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'start.ps1') -PathType Leaf)) {
    throw (Get-CodexPetText '未找到 Codex Pet 的 start.ps1，请检查 AppRoot。' 'Codex Pet start.ps1 was not found. Check AppRoot.')
}

function Get-TaskFollowKey {
    $taskHasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $taskBytes = [System.Text.Encoding]::UTF8.GetBytes($taskRoot.ToLowerInvariant())
        return ([System.BitConverter]::ToString($taskHasher.ComputeHash($taskBytes))).Replace('-', '').Substring(0, 24)
    } finally { $taskHasher.Dispose() }
}

function Test-TaskCodexUi {
    # 只接受Codex自己的桌面程序；同名的ChatGPT应用和CLI不算桌面启动。
    foreach ($taskProcess in @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue)) {
        try {
            $taskPath = $taskProcess.Path
            if (-not $taskPath -or [System.IO.Path]::GetFileName($taskPath) -ine 'ChatGPT.exe') { continue }
            if ($taskPath -match '[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]') { return $true }
            $taskProduct = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($taskPath).ProductName
            if ($taskProduct -ieq 'Codex' -or $taskProduct -ieq 'OpenAI Codex') { return $true }
        } catch { # 无法读取的进程不作为Codex证据。
        }
    }
    return $false
}

function Get-TaskPetHost {
    if ($PetHost -ne 'auto') { return $PetHost }
    try {
        $taskHostFile = Get-Item -LiteralPath (Join-Path $taskRoot 'data/host.json') -ErrorAction Stop
        if ($taskHostFile.PSIsContainer -or $taskHostFile.Length -gt 4096) { return 'codex' }
        $taskHostValue = [IO.File]::ReadAllText($taskHostFile.FullName) | ConvertFrom-Json -ErrorAction Stop
        if ($taskHostValue.schemaVersion -eq 1 -and $taskHostValue.host -eq 'workbuddy') { return 'workbuddy' }
    } catch { # 缺失或损坏的选择不改变既有Codex默认值。
    }
    return 'codex'
}

function Test-TaskWorkBuddyUi {
    foreach ($taskProcess in @(Get-Process -Name 'WorkBuddy' -ErrorAction SilentlyContinue)) {
        try {
            if ([IO.Path]::GetFileName([string]$taskProcess.Path) -ine 'WorkBuddy.exe') { continue }
            if ([string]$taskProcess.Product -ieq 'WorkBuddy' -and [string]$taskProcess.Company -ieq 'Tencent Technology (Shenzhen) Company Limited') { return $true }
        } catch { # 无法确认产品与发行方的进程不计入宿主。
        }
    }
    return $false
}

function Test-TaskHostUi([string]$SelectedHost) {
    if ($SelectedHost -eq 'workbuddy') { return Test-TaskWorkBuddyUi }
    return Test-TaskCodexUi
}

function Write-TaskProbe([bool]$Running, [bool]$WouldStart, [bool]$Started) {
    [ordered]@{
        host = $taskSelectedHost
        hostRunning = $Running
        codexRunning = ($taskSelectedHost -eq 'codex' -and $Running)
        workbuddyRunning = ($taskSelectedHost -eq 'workbuddy' -and $Running)
        wouldStart = $WouldStart
        startRequested = $Started
        noStart = [bool]$NoStart
        once = [bool]$Once
    } | ConvertTo-Json -Compress
}

if ($Once -and $NoStart) {
    $taskSelectedHost = Get-TaskPetHost
    $taskRunning = Test-TaskHostUi $taskSelectedHost
    Write-TaskProbe $taskRunning $taskRunning $false
    return
}

$taskKey = Get-TaskFollowKey
$taskMutex = [System.Threading.Mutex]::new($false, "Local\dsh-pet-codex-follow-$taskKey")
$taskStop = $null
$taskOwnsMutex = $false
try {
    try { $taskOwnsMutex = $taskMutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $taskOwnsMutex = $true }
    if (-not $taskOwnsMutex) {
        @{ alreadyWatching = $true } | ConvertTo-Json -Compress
        return
    }
    $taskStop = [System.Threading.EventWaitHandle]::new($false, [System.Threading.EventResetMode]::ManualReset, "Local\dsh-pet-codex-follow-stop-$taskKey")
    $taskStop.Reset() | Out-Null
    $taskWasRunning = $false
    $taskPreviousHost = $null
    do {
        if ($taskStop.WaitOne(0)) { break }
        $taskSelectedHost = Get-TaskPetHost
        # 一个watcher跟随当前明确选择的宿主，切换后重新建立该宿主的启动边沿。
        if ($taskPreviousHost -ne $taskSelectedHost) { $taskWasRunning = $false; $taskPreviousHost = $taskSelectedHost }
        $taskRunning = Test-TaskHostUi $taskSelectedHost
        $taskRisingEdge = $taskRunning -and -not $taskWasRunning
        $taskRequested = $false
        if ($taskRisingEdge -and -not $NoStart) {
            try {
                & (Join-Path $taskRoot 'start.ps1') -AppRoot $taskRoot -Reason $taskSelectedHost | Out-Null
                $taskRequested = $true
            } catch {
                [Console]::Error.WriteLine((Get-CodexPetText '跟随启动失败，请运行 setup.ps1 并检查 Codex Pet 日志。' 'Follow-startup failed. Run setup.ps1 and check the Codex Pet logs.'))
            }
        }
        if ($Once -or $NoStart -or $taskRisingEdge) { Write-TaskProbe $taskRunning $taskRisingEdge $taskRequested }
        # 用户手动停宠物后，只在宿主下次启动或用户切换宿主时再启动。
        $taskWasRunning = $taskRunning
        if ($Once) { break }
    } while (-not $taskStop.WaitOne($PollSeconds * 1000))
} finally {
    if ($taskStop) { $taskStop.Dispose() }
    if ($taskOwnsMutex) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
}
