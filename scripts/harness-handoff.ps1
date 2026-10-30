[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('inspect','install')][string]$Action,
    [Parameter(Mandatory=$true)][string]$DshCommand,
    [Parameter(Mandatory=$true)][string]$DshHome,
    [Parameter(Mandatory=$true)][string]$AppRoot,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$Profile
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($AppRoot)
$taskHome = [IO.Path]::GetFullPath($DshHome)
$taskCommand = [IO.Path]::GetFullPath($DshCommand)
if (-not (Test-Path -LiteralPath $taskCommand -PathType Leaf) -or [IO.Path]::GetFileName($taskCommand) -notmatch '^dsh(?:\.cmd)?$') { throw 'Harness command unavailable.' }
$taskPetData = (Join-Path $taskRoot 'data').TrimEnd('\','/')
if ($taskHome -ieq $taskPetData -or $taskHome.StartsWith($taskPetData + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Harness requires its own data folder.' }
# 仅对已选择的正式 CLI 查询版本；不读取账户、会话或全局包缓存。
$env:DSH_HOME = $taskHome
$taskVersion = (& $taskCommand --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Harness version unavailable.' }
if ($Action -eq 'inspect') {
    @{ok=$true;version=$taskVersion} | ConvertTo-Json -Compress
    return
}
if ($taskVersion -notin @('0.2.1-rc.2','0.2.1-rc.5') -or -not $Profile) { throw 'Harness compatibility is unverified.' }
if ($taskCommand -match '[\\/]resources[\\/]runtime[\\/]cli[\\/]bin[\\/]dsh\.cmd$') {
    $taskInstallRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetDirectoryName($taskCommand)) '../../../..')).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
    $taskDesktopRunning = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and $_.Path.StartsWith($taskInstallRoot,[StringComparison]::OrdinalIgnoreCase) } catch { $false } })
    if ($taskDesktopRunning.Count -gt 0) { throw 'Quit Harness Desktop before changing its plugins.' }
}
$taskNode = Join-Path $taskRoot 'data/runtime/node/node.exe'
if (-not (Test-Path -LiteralPath $taskNode -PathType Leaf)) { $taskNode = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
# 现有安装器只经官方 plugin CLI 修改所选 profile，并保留其它 profile 与角色文件。
$taskInstallOutput = & (Join-Path $taskRoot 'scripts/install-harness.ps1') -Profile $Profile -DshHome $taskHome -DshCommand $taskCommand -NodeCommand $taskNode
if ($LASTEXITCODE -ne 0) { throw 'Harness plugin installation failed.' }
@{ok=$true;version=$taskVersion;profile=$Profile} | ConvertTo-Json -Compress
