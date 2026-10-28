$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts/locale.ps1')
$taskPortableNode = Join-Path $PSScriptRoot 'data/runtime/node/node.exe'
$taskNode = if (Test-Path -LiteralPath $taskPortableNode -PathType Leaf) { $taskPortableNode } else { (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
$taskNpm = Join-Path (Split-Path $taskNode) 'npm.cmd'
$taskPreviousPath = $env:PATH
$env:PATH = (Split-Path $taskNode) + ';' + $taskPreviousPath
Push-Location -LiteralPath $PSScriptRoot
try {
    & $taskNpm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw (Get-CodexPetText '安装依赖失败。' 'Failed to install dependencies.') }
    & $taskNode scripts/prepare-runtime.mjs
    if ($LASTEXITCODE -ne 0) { throw (Get-CodexPetText '准备运行时失败。' 'Failed to prepare the runtime.') }
} finally { Pop-Location; $env:PATH = $taskPreviousPath }
