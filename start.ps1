[CmdletBinding()]
param([string]$AppRoot, [switch]$NoStart)

$ErrorActionPreference = 'Stop'
if (-not $AppRoot) { $AppRoot = $PSScriptRoot }
$taskRoot = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\', '/')
$taskApp = Join-Path $taskRoot 'src/app.mjs'
$taskPortableNode = Join-Path $taskRoot 'data/runtime/node/node.exe'
$taskNode = if (Test-Path -LiteralPath $taskPortableNode -PathType Leaf) {
    $taskPortableNode
} else {
    $taskFoundNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($taskFoundNode) { $taskFoundNode.Source } else { $null }
}
$taskReady = Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/dsh-pet/lib/codex-host.js') -PathType Leaf

function Test-TaskPetRunning {
    $taskRuntime = Join-Path $taskRoot 'data/dsh-pet/standalone-runtime.json'
    if (Test-Path -LiteralPath $taskRuntime -PathType Leaf) {
        try {
            $taskState = Get-Content -LiteralPath $taskRuntime -Raw | ConvertFrom-Json
            $taskPort = [int]$taskState.port
            if ($taskPort -gt 0 -and $taskPort -lt 65536) {
                $taskHealth = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $taskPort) -TimeoutSec 2
                if ($taskHealth.StatusCode -eq 200) { return $true }
            }
        } catch { # 已退出实例的旧清单不阻止重新启动。
        }
    }
    # 服务尚未就绪时也识别本目录的Node进程，避免重复启动覆盖正在写的日志。
    try {
        $taskNeedle = $taskApp.Replace('/', '\')
        foreach ($taskProcess in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop)) {
            $taskCommand = [string]$taskProcess.CommandLine
            if ($taskCommand.Replace('/', '\').IndexOf($taskNeedle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $taskCommand -notmatch '(?:^|\s)--stop(?:\s|$)') { return $true }
        }
    } catch { # 权限不足时仍保留上面的本机健康检查结果。
    }
    return $false
}

if ($NoStart) {
    $taskRunning = Test-TaskPetRunning
    [ordered]@{ alreadyRunning = $taskRunning; nodeAvailable = [bool]$taskNode; portableNode = ($taskNode -eq $taskPortableNode); runtimeReady = [bool]$taskReady; wouldStart = (-not $taskRunning -and [bool]$taskNode -and [bool]$taskReady) } | ConvertTo-Json -Compress
    return
}
if (-not $taskNode) { throw '未找到 Node.js，请运行 install.ps1 安装便携运行时，或安装 Node.js 后运行 setup.ps1。' }
if (-not $taskReady -or -not (Test-Path -LiteralPath $taskApp -PathType Leaf)) { throw '请先运行本目录的 setup.ps1。' }
$taskHasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $taskKey = ([System.BitConverter]::ToString($taskHasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($taskRoot.ToLowerInvariant())))).Replace('-', '').Substring(0, 24)
} finally { $taskHasher.Dispose() }
$taskMutex = [System.Threading.Mutex]::new($false, "Local\dsh-pet-codex-start-$taskKey")
$taskOwnsMutex = $false
try {
    try { $taskOwnsMutex = $taskMutex.WaitOne(10000) }
    catch [System.Threading.AbandonedMutexException] { $taskOwnsMutex = $true }
    if (-not $taskOwnsMutex) { throw '桌宠启动正在进行，请稍后重试。' }
    if (Test-TaskPetRunning) { Write-Output '大肥鱼已经在运行。'; return }
    $taskData = Join-Path $taskRoot 'data'
    New-Item -ItemType Directory -Path $taskData -Force | Out-Null
    Start-Process -FilePath $taskNode -ArgumentList @('"' + $taskApp + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'app.log') -RedirectStandardError (Join-Path $taskData 'app-error.log')
} finally {
    if ($taskOwnsMutex) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
}
