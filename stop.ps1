$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts/locale.ps1')
$taskPortableNode = Join-Path $PSScriptRoot 'data/runtime/node/node.exe'
$taskNode = if (Test-Path -LiteralPath $taskPortableNode -PathType Leaf) { $taskPortableNode } else { (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
& $taskNode (Join-Path $PSScriptRoot 'src/app.mjs') --stop
if ($LASTEXITCODE -ne 0) { throw (Get-CodexPetText '停止请求失败，请查看 data/app-error.log。' 'The stop request failed. Check data/app-error.log.') }
