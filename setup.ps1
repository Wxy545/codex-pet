$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    & npm.cmd ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw '安装依赖失败。' }
    & node.exe scripts/prepare-runtime.mjs
    if ($LASTEXITCODE -ne 0) { throw '准备运行时失败。' }
} finally { Pop-Location }
