[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$AppRoot,
    [Alias('NoStart')][switch]$NoStartWatcher
)

$ErrorActionPreference = 'Stop'
if (-not $AppRoot) { $AppRoot = Split-Path -Parent $PSScriptRoot }
$taskRoot = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\', '/')
$taskVbs = Join-Path $taskRoot 'scripts/follow-codex.vbs'
foreach ($taskRequired in @($taskVbs, (Join-Path $taskRoot 'scripts/follow-codex.ps1'), (Join-Path $taskRoot 'start.ps1'))) {
    if (-not (Test-Path -LiteralPath $taskRequired -PathType Leaf)) { throw '跟随启动文件不完整，请重新安装本项目。' }
}
$taskStartup = [Environment]::GetFolderPath('Startup')
if (-not $taskStartup) { throw '无法取得当前用户 Startup 文件夹。' }
$taskShortcut = Join-Path $taskStartup 'dsh-pet-codex-follow.lnk'
if (-not $PSCmdlet.ShouldProcess($taskShortcut, '注册当前用户的Codex桌宠跟随启动')) { return }
New-Item -ItemType Directory -Path $taskStartup -Force | Out-Null
$taskShell = New-Object -ComObject WScript.Shell
$taskLink = $taskShell.CreateShortcut($taskShortcut)
$taskMarker = 'dsh-pet-codex follow Codex startup'
if ((Test-Path -LiteralPath $taskShortcut) -and $taskLink.Description -ne $taskMarker) {
    throw '同名 Startup 项不属于本项目，未覆盖。'
}
$taskWscript = Join-Path $env:SystemRoot 'System32/wscript.exe'
$taskLink.TargetPath = $taskWscript
$taskLink.Arguments = '"' + $taskVbs + '" "' + $taskRoot + '"'
$taskLink.WorkingDirectory = $taskRoot
$taskLink.WindowStyle = 7
$taskLink.Description = $taskMarker
$taskLink.Save()

if (-not $NoStartWatcher) {
    Start-Process -FilePath $taskWscript -ArgumentList @('"' + $taskVbs + '"', '"' + $taskRoot + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden
}
[ordered]@{ enabled = $true; watcherRequested = -not [bool]$NoStartWatcher; shortcut = $taskShortcut } | ConvertTo-Json -Compress
