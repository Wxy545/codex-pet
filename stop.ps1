$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
& $taskNode (Join-Path $PSScriptRoot 'src/app.mjs') --stop
if ($LASTEXITCODE -ne 0) { throw '停止请求失败，请查看 data/app-error.log。' }
