$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/dsh-pet/lib/codex-host.js'))) {
    throw '请先运行本目录的 setup.ps1。'
}
$taskData = Join-Path $taskRoot 'data'
New-Item -ItemType Directory -Path $taskData -Force | Out-Null
Start-Process -FilePath $taskNode -ArgumentList @('"' + (Join-Path $taskRoot 'src/app.mjs') + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'app.log') -RedirectStandardError (Join-Path $taskData 'app-error.log')
