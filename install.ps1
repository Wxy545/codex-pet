[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'codex-pet'),
    [ValidateSet('codex','workbuddy')][string]$CompanionHost = 'codex',
    [string]$WorkBuddyExe,
    [switch]$NoStart,
    [switch]$NoFollow
)

# 脚本消息跟随Windows显示语言；不修改系统设置，也不改变技术JSON字段。
function Get-CodexPetText {
    param([string]$Chinese, [string]$English)
    $taskUiLanguage = [string](Get-UICulture).Name
    if ($taskUiLanguage -match '^zh(?:[-_]|$)') { return $Chinese }
    return $English
}

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$installerRepo = 'Wxy545/codex-pet'
$installerTarget = [IO.Path]::GetFullPath($InstallDir)
$installerTemp = Join-Path ([IO.Path]::GetTempPath()) ('codex-pet-' + [Guid]::NewGuid().ToString('N'))
$installerOldPath = $env:PATH

function Get-UsableNode {
    $candidate = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $candidate) { return $null }
    try {
        $versionText = & $candidate.Source --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $versionText -match '^v(\d+\.\d+\.\d+)$' -and
            [version]$Matches[1] -ge [version]'22.12.0' -and
            (Test-Path -LiteralPath (Join-Path (Split-Path $candidate.Source) 'npm.cmd'))) {
            return $candidate.Source
        }
    } catch { }
    return $null
}

function Get-PortableNode([string]$AppDir) {
    # 便携运行时只写入本程序目录，不安装系统组件，也不修改用户 PATH。
    $releases = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $release = $releases | Where-Object {
        $_.version -match '^v24\.\d+\.\d+$' -and $_.lts -and 'win-x64-zip' -in $_.files
    } | Sort-Object { [version]$_.version.Substring(1) } -Descending | Select-Object -First 1
    if (-not $release) { throw (Get-CodexPetText '未找到 Node.js 24 LTS 的 Windows x64 官方下载。' 'The official Node.js 24 LTS download for Windows x64 was not found.') }
    $zipName = 'node-' + $release.version + '-win-x64.zip'
    $baseUrl = 'https://nodejs.org/dist/' + $release.version
    $checksums = (Invoke-WebRequest ($baseUrl + '/SHASUMS256.txt') -UseBasicParsing).Content
    $matchingLines = @($checksums -split '\r?\n' | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+' + [regex]::Escape($zipName) + '$') })
    if ($matchingLines.Count -ne 1) { throw (Get-CodexPetText 'Node.js 官方校验清单没有唯一匹配项。' 'The official Node.js checksum list has no unique matching entry.') }
    $expectedHash = ($matchingLines[0] -split '\s+')[0]
    $zipPath = Join-Path $installerTemp $zipName
    Invoke-WebRequest ($baseUrl + '/' + $zipName) -UseBasicParsing -OutFile $zipPath
    if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ne $expectedHash) {
        throw (Get-CodexPetText 'Node.js 下载校验失败，已停止安装。' 'The Node.js download failed checksum verification. Installation stopped.')
    }
    $runtimeDir = Join-Path $AppDir 'data/runtime'
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    Expand-Archive -LiteralPath $zipPath -DestinationPath $runtimeDir
    $unpacked = Join-Path $runtimeDir ('node-' + $release.version + '-win-x64')
    $portableDir = Join-Path $runtimeDir 'node'
    # 两个目录均由本次安装创建，移动范围限定在新的运行时目录内。
    if (-not ([IO.Path]::GetFullPath($unpacked).StartsWith($runtimeDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))) {
        throw (Get-CodexPetText 'Node.js 解压目录超出安装范围。' 'The extracted Node.js directory is outside the installation folder.')
    }
    Move-Item -LiteralPath $unpacked -Destination $portableDir
    return (Join-Path $portableDir 'node.exe')
}

function Wait-PetReady([string]$AppDir) {
    Write-Host (Get-CodexPetText '正在启动 Codex Pet。首次启动需要下载 Electron，请等待 ...' 'Starting Codex Pet. The first launch downloads Electron; please wait...')
    $deadline = [DateTime]::UtcNow.AddMinutes(11)
    $runtimeFile = Join-Path $AppDir 'data/dsh-pet/standalone-runtime.json'
    $helperMain = (Join-Path $AppDir 'node_modules/dsh-pet/runtime/electron-helper/main.js').Replace('/', '\')
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
            $health = Invoke-RestMethod ('http://127.0.0.1:' + [int]$runtime.port + '/health') -TimeoutSec 2 -UseBasicParsing
            if ($health.name -in @('codex-pet', 'dsh-pet-codex') -and [int]$health.pid -eq [int]$runtime.pid) {
                $helpers = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId={0} AND Name='electron.exe'" -f [int]$health.pid))
                foreach ($helper in $helpers) {
                    if (([string]$helper.CommandLine).Replace('/', '\').IndexOf($helperMain, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return }
                }
            }
        } catch { # 源码准备、服务启动和 Electron 下载期间继续等候，不把它们误报为就绪。
        }
        Start-Sleep -Seconds 2
    }
    throw ((Get-CodexPetText '文件已安装，但未确认 Codex Pet 启动。请查看 ' 'Files were installed, but Codex Pet has not been confirmed ready. Check ') + (Join-Path $AppDir 'data/app.log') + (Get-CodexPetText ' 和 app-error.log，排查 Electron 下载或启动问题。' ' and app-error.log for Electron download or startup errors.'))
}

try {
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) {
        throw (Get-CodexPetText '当前安装器支持 Windows 64 位。' 'This installer supports 64-bit Windows.')
    }
    # 新默认目录不搬迁旧安装；未指定新目录时先明确拒绝，避免建立第二个跟随实例。
    $legacyInstall = Join-Path $env:LOCALAPPDATA 'dsh-pet-codex'
    if (-not $PSBoundParameters.ContainsKey('InstallDir') -and (Test-Path -LiteralPath $legacyInstall)) {
        throw ((Get-CodexPetText '发现已有旧安装，未移动或覆盖：{0}。请按 docs/maintenance.md 更新原目录，或显式指定新的 -InstallDir。' 'An existing installation was found and was not moved or overwritten: {0}. Follow docs/maintenance.md to update that folder, or explicitly choose a new -InstallDir.') -f $legacyInstall)
    }
    if (Test-Path -LiteralPath $installerTarget) {
        throw ((Get-CodexPetText '安装目录已存在，未覆盖任何文件：' 'The installation directory already exists. No files were overwritten: ') + $installerTarget + (Get-CodexPetText '。已有安装请按 docs/maintenance.md 更新，或通过 -InstallDir 指定新目录。' '. For an existing installation, follow docs/maintenance.md, or choose a new folder with -InstallDir.'))
    }
    New-Item -ItemType Directory -Path $installerTemp | Out-Null
    Write-Host (Get-CodexPetText '正在下载 Codex Pet ...' 'Downloading Codex Pet...')
    $ref = Invoke-RestMethod ('https://api.github.com/repos/' + $installerRepo + '/git/ref/heads/main') -Headers @{ 'User-Agent' = 'codex-pet-installer' } -UseBasicParsing
    $sourceCommit = [string]$ref.object.sha
    if ($sourceCommit -notmatch '^[a-f0-9]{40}$') { throw (Get-CodexPetText 'GitHub 返回的源码版本无效。' 'GitHub returned an invalid source revision.') }
    # 一次安装固定到同一个提交，避免安装过程中 main 变化造成文件混用。
    $archive = Join-Path $installerTemp 'source.zip'
    Invoke-WebRequest ('https://github.com/' + $installerRepo + '/archive/' + $sourceCommit + '.zip') -UseBasicParsing -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $installerTemp
    $appStage = Join-Path $installerTemp ('codex-pet-' + $sourceCommit)
    $manifest = Get-Content -LiteralPath (Join-Path $appStage 'package.json') -Raw | ConvertFrom-Json
    if ($manifest.name -ne 'codex-pet' -or -not (Test-Path -LiteralPath (Join-Path $appStage 'scripts/prepare-runtime.mjs'))) {
        throw (Get-CodexPetText '下载内容缺少预期的项目文件。' 'The download does not contain the expected project files.')
    }
    $nodePath = Get-UsableNode
    $portable = -not $nodePath
    if ($portable) {
        Write-Host (Get-CodexPetText '正在准备官方 Node.js 24 LTS 便携运行时 ...' 'Preparing the official portable Node.js 24 LTS runtime...')
        $nodePath = Get-PortableNode $appStage
    }
    $env:PATH = (Split-Path $nodePath) + ';' + $installerOldPath
    $npmPath = Join-Path (Split-Path $nodePath) 'npm.cmd'
    Push-Location -LiteralPath $appStage
    try {
        # 只确认本机 CLI 可执行文件存在，不读取凭据，也不发起模型请求。
        if ($CompanionHost -eq 'codex') {
            & $nodePath --input-type=module -e "import { locateCodex } from './src/codex-path.mjs'; locateCodex();"
            if ($LASTEXITCODE -ne 0) { throw (Get-CodexPetText '未找到 Codex CLI。请先安装 Codex，或用 CODEX_PET_CLI 指向真实的 codex.exe。' 'Codex CLI was not found. Install Codex first, or set CODEX_PET_CLI to the actual codex.exe.') }
        } else {
            if (-not $WorkBuddyExe) {
                $taskBuddyPaths = @(Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue | ForEach-Object {
                    try { if ($_.Path -and $_.Product -eq 'WorkBuddy' -and $_.Company -eq 'Tencent Technology (Shenzhen) Company Limited') { $_.Path } } catch {}
                } | Select-Object -Unique)
                if ($taskBuddyPaths.Count -eq 1) { $WorkBuddyExe = $taskBuddyPaths[0] }
            }
            if (-not $WorkBuddyExe -or -not (Test-Path -LiteralPath $WorkBuddyExe -PathType Leaf)) {
                throw (Get-CodexPetText '请先安装并打开 WorkBuddy，或用 -WorkBuddyExe 指定它的程序路径。' 'Install and open WorkBuddy first, or pass its executable path with -WorkBuddyExe.')
            }
        }
        Write-Host (Get-CodexPetText '正在安装 Codex Pet 依赖 ...' 'Installing Codex Pet dependencies...')
        & $npmPath ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
        if ($LASTEXITCODE -ne 0) { throw (Get-CodexPetText '安装 Codex Pet 依赖失败。' 'Failed to install Codex Pet dependencies.') }
        & $nodePath src/host-cli.mjs --host $CompanionHost
        if ($LASTEXITCODE -ne 0) { throw (Get-CodexPetText '保存联动应用失败。' 'Could not save the companion app.') }
        & $nodePath scripts/prepare-runtime.mjs
        if ($LASTEXITCODE -ne 0) { throw (Get-CodexPetText '准备 Codex Pet 运行时失败。' 'Failed to prepare the Codex Pet runtime.') }
    } finally { Pop-Location }
    New-Item -ItemType Directory -Path (Join-Path $appStage 'data') -Force | Out-Null
    @{ sourceCommit = $sourceCommit; installedAt = [DateTime]::UtcNow.ToString('o'); portableNode = [bool]$portable } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appStage 'data/install-info.json') -Encoding UTF8
    $parent = Split-Path -Parent $installerTarget
    if (-not $parent) { throw (Get-CodexPetText '请指定完整的安装目录。' 'Specify an absolute installation directory.') }
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    # 仅把本次临时目录内的源码移到用户明确指定、尚不存在的目标。
    if (-not ([IO.Path]::GetFullPath($appStage).StartsWith($installerTemp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) -or
        (Test-Path -LiteralPath $installerTarget)) { throw (Get-CodexPetText '安装目录发生变化，已停止移动文件。' 'The installation directory changed. File transfer stopped.') }
    if ([IO.Path]::GetPathRoot($appStage) -ieq [IO.Path]::GetPathRoot($installerTarget)) {
        Move-Item -LiteralPath $appStage -Destination $installerTarget
    } else {
        # PowerShell 不能跨盘移动目录；新目标先复制成功，再由 finally 清理本次临时目录。
        Copy-Item -LiteralPath $appStage -Destination $installerTarget -Recurse
    }
    if ($CompanionHost -eq 'workbuddy') {
        & (Join-Path $installerTarget 'workbuddy/install.ps1') -AppRoot $installerTarget -WorkBuddyExe $WorkBuddyExe
        if ($LASTEXITCODE -ne 0) { throw (Get-CodexPetText '安装 WorkBuddy 桌宠插件失败。' 'Could not install the WorkBuddy companion plugin.') }
    }
    if (-not $NoFollow) {
        & (Join-Path $installerTarget 'scripts/enable-follow.ps1') -AppRoot $installerTarget -NoStartWatcher:$NoStart
    }
    if (-not $NoStart) {
        & (Join-Path $installerTarget 'start.ps1')
        Wait-PetReady $installerTarget
    }
    Write-Host ((Get-CodexPetText '安装完成：' 'Installed to: ') + $installerTarget)
    Write-Host ((Get-CodexPetText '源码版本：' 'Source revision: ') + $sourceCommit)
    if ($NoStart) { Write-Host (Get-CodexPetText '按要求未启动 Codex Pet；可双击安装目录中的“启动龙娘桌宠.vbs”。' 'Codex Pet was not started, as requested. Double-click Start Codex Pet.vbs in the installation folder to launch it.') }
} finally {
    $env:PATH = $installerOldPath
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $cleanupPath = [IO.Path]::GetFullPath($installerTemp)
    if ($cleanupPath.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($cleanupPath) -match '^codex-pet-[a-f0-9]{32}$' -and
        (Test-Path -LiteralPath $cleanupPath)) {
        Remove-Item -LiteralPath $cleanupPath -Recurse -Force
    }
}
