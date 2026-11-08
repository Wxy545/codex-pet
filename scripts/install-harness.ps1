[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$Profile = 'web',
    [string]$DshHome,
    [string]$DshCommand,
    [string]$NodeCommand,
    [string]$HarnessNodeCommand
)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
if (-not $NodeCommand) { $NodeCommand = (Get-Command node -ErrorAction Stop).Source }
if (-not $DshCommand) {
    $taskDshExecutable = Get-Command dsh -ErrorAction SilentlyContinue
    if (-not $taskDshExecutable) { throw 'Install DeepSeek Harness first: npm install -g @deepseek-ai/dsh@0.2.2-rc.1 (Node.js 24.9+)' }
    $DshCommand = $taskDshExecutable.Source
}
$taskBundledCli = $DshCommand -match '[\\/]resources[\\/]runtime[\\/]cli[\\/]bin[\\/]dsh(?:\.cmd)?$'
if ($Profile -ieq 'desktop' -and -not $taskBundledCli) {
    throw 'For desktop, pass the official Desktop resources/runtime/cli/bin/dsh.cmd with -DshCommand. The npm CLI cannot manage this profile.'
}
if (-not $taskBundledCli -and -not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'The npm Harness CLI needs pnpm on PATH. Install pnpm first, then retry.'
}
. (Join-Path $PSScriptRoot 'harness-runtime.ps1')
$taskRuntime = Get-HarnessCliRuntime -DshCommand $DshCommand -HarnessNodeCommand $HarnessNodeCommand

$taskPreviousHome = [Environment]::GetEnvironmentVariable('DSH_HOME', 'Process')
$taskPreviousPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
try {
    if ($taskRuntime.NodeCommand) { $env:PATH = [IO.Path]::GetDirectoryName($taskRuntime.NodeCommand) + [IO.Path]::PathSeparator + $taskPreviousPath }
    if ($DshHome) { $env:DSH_HOME = [IO.Path]::GetFullPath($DshHome) }
    if ($Profile -ieq 'desktop') {
        & $DshCommand plugin --profile desktop list --depth 0
        if ($LASTEXITCODE -ne 0) { throw 'For desktop, initialize Harness Desktop, fully quit it, and pass its bundled resources/runtime/cli/bin/dsh.cmd with -DshCommand. The npm CLI cannot manage this profile.' }
    }
    $taskResolvedHome = if ($env:DSH_HOME) { [IO.Path]::GetFullPath($env:DSH_HOME) } else { Join-Path $env:USERPROFILE '.dsh' }
    $taskProfileRoot = Join-Path (Join-Path $taskResolvedHome 'profiles') $Profile
    $taskExistingPet = Join-Path $taskProfileRoot 'node_modules/dsh-pet/package.json'
    if (Test-Path -LiteralPath $taskExistingPet) {
        $taskPetMetadata = Get-Content -LiteralPath $taskExistingPet -Raw | ConvertFrom-Json
        if ($taskPetMetadata.version -notin @('0.4.0','0.4.1','0.4.3','0.4.5','0.4.6')) { throw ('This bundle supports dsh-pet 0.4.0, 0.4.1, 0.4.3, 0.4.5 and 0.4.6. Kept the existing version {0}.' -f $taskPetMetadata.version) }
    }
    & $NodeCommand (Join-Path $PSScriptRoot 'build-harness-plugin.mjs') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The White Dragon Girl bundle could not be built.' }
    # 使用PowerShell自己的Unicode路径，避免WinPS5经stdout解码中文目录时丢失字符。
    $taskBundleDirectory = Join-Path $taskRoot 'data/harness-plugin'
    if (-not (Test-Path -LiteralPath (Join-Path $taskBundleDirectory 'pack.json'))) { throw 'The prepared bundle is incomplete.' }
    # 两层按官方CLI顺序安装；只由dsh维护所选profile的依赖与bundle列表。
    & $DshCommand plugin --profile $Profile add 'dsh-pet@0.4.6'
    if ($LASTEXITCODE -ne 0) { throw 'dsh-pet installation failed; the dragon bundle was not activated.' }
    & $DshCommand plugin --profile $Profile add $taskBundleDirectory
    if ($LASTEXITCODE -ne 0) { throw 'The dragon bundle installation failed.' }
    # Loader 会先导入模块再等待 inject；首次启动前离线修补，避免进程缓存旧宿主函数。
    & $NodeCommand (Join-Path $PSScriptRoot 'prepare-harness-profile.mjs') --profile-dir $taskProfileRoot --bundle-dir $taskBundleDirectory --dsh-version $taskRuntime.Version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The installed Harness profile could not be prepared. It was not connected; keep Harness closed and retry the installation.' }
    Write-Output ('White Dragon Girl is installed in the {0} profile. Restart that Harness profile to load it.' -f $Profile)
} finally {
    [Environment]::SetEnvironmentVariable('DSH_HOME', $taskPreviousHome, 'Process')
    [Environment]::SetEnvironmentVariable('PATH', $taskPreviousPath, 'Process')
}
