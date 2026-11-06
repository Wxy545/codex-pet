# 只给所选 Harness 命令准备进程内运行环境，不改变用户或系统 PATH。
function Get-HarnessCliRuntime {
    param([Parameter(Mandatory=$true)][string]$DshCommand, [string]$HarnessNodeCommand)
    $taskBundled = $DshCommand -match '[\\/]resources[\\/]runtime[\\/]cli[\\/]bin[\\/]dsh(?:\.cmd)?$'
    $taskPreviousPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
    $taskNode = $null
    $taskNodeVersion = $null
    try {
        if (-not $taskBundled) {
            # npm 官方 shim 固定优先相邻 node.exe，PATH 不能覆盖这一路。
            $taskAdjacentNode = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($DshCommand))) 'node.exe'
            $taskCandidates = if (Test-Path -LiteralPath $taskAdjacentNode -PathType Leaf) { @($taskAdjacentNode) }
                elseif ($HarnessNodeCommand) { @([IO.Path]::GetFullPath($HarnessNodeCommand)) }
                else { @(Get-Command node.exe -All -CommandType Application -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source) }
            $taskNodes = @(foreach ($taskCandidate in ($taskCandidates | Select-Object -Unique)) {
                if (-not (Test-Path -LiteralPath $taskCandidate -PathType Leaf)) { continue }
                try {
                    $taskOutput = (& $taskCandidate --version 2>$null | Out-String).Trim()
                    if ($LASTEXITCODE -eq 0 -and $taskOutput -match '^v(\d+)\.(\d+)\.(\d+)$') {
                        $taskSemver = [version]($taskOutput.Substring(1))
                        if ($taskSemver -ge [version]'22.12.0') { [pscustomobject]@{ Command=$taskCandidate; Version=$taskSemver } }
                    }
                } catch { }
            })
            $taskSelected = $taskNodes | Sort-Object Version -Descending | Select-Object -First 1
            if (-not $taskSelected) { throw 'Harness needs an installed Node.js runtime (22.12+ for 0.2.1; 24.9+ for 0.2.2). No compatible runtime was found.' }
            $taskNode = $taskSelected.Command
            $taskNodeVersion = $taskSelected.Version
            $env:PATH = [IO.Path]::GetDirectoryName($taskNode) + [IO.Path]::PathSeparator + $taskPreviousPath
        }
        # 桌面版保留自己的启动器与内置运行时，不用项目的便携 Node 接管它。
        $taskVersion = (& $DshCommand --version | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Harness could not start. Check its own runtime; Harness 0.2.2 requires Node.js 24.9 or later.' }
        if ($taskVersion -notin @('0.2.1-rc.2','0.2.1-rc.5','0.2.2-rc.1')) { throw 'Other versions have not been verified. Use Harness 0.2.1-rc.2, 0.2.1-rc.5 or 0.2.2-rc.1.' }
        if (-not $taskBundled -and $taskVersion -eq '0.2.2-rc.1' -and $taskNodeVersion -lt [version]'24.9.0') { throw 'Harness 0.2.2-rc.1 requires Node.js 24.9 or later. The selected CLI runtime is older; the pet and its settings were kept.' }
        return [pscustomobject]@{ Version=$taskVersion; NodeCommand=$taskNode; NodeVersion=if($taskNodeVersion){$taskNodeVersion.ToString()}else{$null}; Bundled=$taskBundled }
    } finally {
        [Environment]::SetEnvironmentVariable('PATH', $taskPreviousPath, 'Process')
    }
}
