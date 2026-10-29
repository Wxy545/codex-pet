$ErrorActionPreference = 'Stop'
try {
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    $taskBuilder = [System.Text.StringBuilder]::new()
    $taskBuffer = [char[]]::new(4096)
    while (($taskRead = [Console]::In.Read($taskBuffer, 0, $taskBuffer.Length)) -gt 0) {
        if ($taskBuilder.Length + $taskRead -gt 1048576) { exit 0 }
        [void]$taskBuilder.Append($taskBuffer, 0, $taskRead)
    }
    $taskPlugin = Split-Path -Parent $PSScriptRoot
    $taskConfig = Get-Content -LiteralPath (Join-Path $taskPlugin 'connection.json') -Raw | ConvertFrom-Json
    if ($taskConfig.schemaVersion -ne 1 -or -not [IO.Path]::IsPathRooted($taskConfig.nodePath) -or -not (Test-Path -LiteralPath $taskConfig.nodePath -PathType Leaf)) { exit 0 }
    # 原生PowerShell直启，避免要求用户额外安装Git Bash或PowerShell 7。
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $taskBuilder.ToString() | & $taskConfig.nodePath (Join-Path $PSScriptRoot 'report.mjs') *> $null
} catch {
    # 桌宠不参与Hook审批；离线、升级或配置失效时保持原任务执行。
}
exit 0
