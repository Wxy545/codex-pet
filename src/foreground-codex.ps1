$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    if (-not ('CodexBluefish.NativeForeground' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CodexBluefish {
    public static class NativeForeground {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    }
}
'@ | Out-Null
    }

    $foregroundHandle = [CodexBluefish.NativeForeground]::GetForegroundWindow()
    if ($foregroundHandle -eq [IntPtr]::Zero) { throw 'foreground-unavailable' }
    $foregroundProcessId = [uint32]0
    $foregroundThread = [CodexBluefish.NativeForeground]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId)
    if ($foregroundThread -eq 0 -or $foregroundProcessId -eq 0) { throw 'foreground-unavailable' }
    $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction Stop
    $isCodexForeground = $false
    if ($foregroundProcess.ProcessName -ieq 'Codex') {
        # Codex CLI 不拥有桌面前台窗；此分支兼容直接命名 Codex.exe 的桌面发行版。
        $isCodexForeground = $true
    } elseif ($foregroundProcess.ProcessName -ieq 'ChatGPT') {
        # 当前 Windows 商店版 UI 文件名是 ChatGPT.exe，产品名和安装包仍为 Codex。
        $productName = [string]$foregroundProcess.Product
        $description = [string]$foregroundProcess.Description
        $executablePath = [string]$foregroundProcess.Path
        if (-not $productName -and -not $description -and -not $executablePath) { throw 'foreground-unavailable' }
        $isCodexForeground = $productName -ieq 'Codex' -or $description -ieq 'Codex' -or $executablePath -match '(?i)[\\/]OpenAI\.Codex_[^\\/]+[\\/]'
    }

    $protocolRegistered = $false
    try {
        # 商店版使用 AppX 协议注册，不要求传统 shell/open/command 存在。
        $protocolKey = Get-Item -LiteralPath 'Registry::HKEY_CLASSES_ROOT\codex' -ErrorAction Stop
        $protocolRegistered = @($protocolKey.Property) -contains 'URL Protocol'
    } catch {
        $protocolRegistered = $false
    }

    [PSCustomObject]@{
        ok = $true
        isCodexForeground = [bool]$isCodexForeground
        protocolRegistered = [bool]$protocolRegistered
    } | ConvertTo-Json -Compress
} catch {
    # 故障只返回固定形状，不输出进程、路径、异常或窗口标题。
    '{"ok":false,"isCodexForeground":false,"protocolRegistered":false}'
}
