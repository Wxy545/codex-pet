[CmdletBinding()]
param([string]$AppRoot, [switch]$NoStart, [ValidateSet('manual', 'codex', 'workbuddy')][string]$Reason = 'manual')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts/locale.ps1')
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
                $taskHealth = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health" -f $taskPort) -TimeoutSec 2
                if ($taskHealth.name -in @('codex-pet', 'dsh-pet-codex') -and [int]$taskState.pid -gt 0 -and [int]$taskHealth.pid -eq [int]$taskState.pid) { return $true }
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

function Send-TaskStartupSignal {
    $taskRuntimeFile = Join-Path $taskRoot 'data/dsh-pet/standalone-runtime.json'
    $taskRuntimeState = Get-Content -LiteralPath $taskRuntimeFile -Raw | ConvertFrom-Json
    $taskRuntimePort = [int]$taskRuntimeState.port
    if ($taskRuntimePort -lt 1 -or $taskRuntimePort -gt 65535 -or [string]$taskRuntimeState.token -notmatch '^[A-Za-z0-9_-]{43}$') {
        throw (Get-CodexPetText '桌宠运行信息无效，请重新启动 Codex Pet。' 'Codex Pet runtime information is invalid. Restart Codex Pet.')
    }
    # 使用现有本机能力令牌投递原因，不启动第二个宿主或输出令牌。
    Invoke-RestMethod -UseBasicParsing -Method Post -Uri ("http://127.0.0.1:{0}/dsh-pet-7340/codex-startup" -f $taskRuntimePort) -Headers @{'x-dsh-pet-token'=[string]$taskRuntimeState.token} -ContentType 'application/json' -Body (@{reason=$Reason}|ConvertTo-Json -Compress) -TimeoutSec 3 | Out-Null
}

if ($NoStart) {
    $taskRunning = Test-TaskPetRunning
    [ordered]@{ alreadyRunning = $taskRunning; nodeAvailable = [bool]$taskNode; portableNode = ($taskNode -eq $taskPortableNode); runtimeReady = [bool]$taskReady; wouldStart = (-not $taskRunning -and [bool]$taskNode -and [bool]$taskReady) } | ConvertTo-Json -Compress
    return
}
if (-not $taskNode) { throw (Get-CodexPetText '未找到 Node.js，请运行 install.ps1 安装便携运行时，或安装 Node.js 后运行 setup.ps1。' 'Node.js was not found. Run install.ps1 for the portable runtime, or install Node.js and run setup.ps1.') }
if (-not $taskReady -or -not (Test-Path -LiteralPath $taskApp -PathType Leaf)) { throw (Get-CodexPetText '请先运行本目录的 setup.ps1。' 'Run setup.ps1 in this installation folder first.') }
$taskHasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $taskKey = ([System.BitConverter]::ToString($taskHasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($taskRoot.ToLowerInvariant())))).Replace('-', '').Substring(0, 24)
} finally { $taskHasher.Dispose() }
$taskMutex = [System.Threading.Mutex]::new($false, "Local\dsh-pet-codex-start-$taskKey")
$taskOwnsMutex = $false
try {
    try { $taskOwnsMutex = $taskMutex.WaitOne(10000) }
    catch [System.Threading.AbandonedMutexException] { $taskOwnsMutex = $true }
    if (-not $taskOwnsMutex) { throw (Get-CodexPetText 'Codex Pet 正在启动，请稍后重试。' 'Codex Pet is starting. Please try again shortly.') }
    if (Test-TaskPetRunning) {
        if ($Reason -in @('codex','workbuddy')) { Send-TaskStartupSignal }
        Write-Output (Get-CodexPetText 'Codex Pet 已在运行。' 'Codex Pet is already running.'); return
    }
    $taskData = Join-Path $taskRoot 'data'
    New-Item -ItemType Directory -Path $taskData -Force | Out-Null
    $taskArguments = @('"' + $taskApp + '"')
    if ($Reason -eq 'codex') { $taskArguments += '--codex-startup' }
    if ($Reason -eq 'workbuddy') { $taskArguments += '--workbuddy-startup' }
    Start-Process -FilePath $taskNode -ArgumentList $taskArguments -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'app.log') -RedirectStandardError (Join-Path $taskData 'app-error.log')
} finally {
    if ($taskOwnsMutex) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
}
