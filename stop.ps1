$ErrorActionPreference = 'Stop'
$taskPortableNode = Join-Path $PSScriptRoot 'data/runtime/node/node.exe'
$taskNode = if (Test-Path -LiteralPath $taskPortableNode -PathType Leaf) { $taskPortableNode } else { (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
& $taskNode (Join-Path $PSScriptRoot 'src/app.mjs') --stop
if ($LASTEXITCODE -ne 0) { throw '停止请求失败，请查看 data/app-error.log。' }
