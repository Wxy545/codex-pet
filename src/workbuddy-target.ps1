[CmdletBinding()]
param([ValidateSet('Probe', 'Focus', 'Foreground', 'Alive')][string]$Action = 'Probe')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Test-WorkBuddyProcess($Process) {
    try {
        $startupPath = [string]$Process.Path
        if (-not $startupPath -or [IO.Path]::GetFileName($startupPath) -ine 'WorkBuddy.exe') { return $false }
        # 产品和发行方均需匹配，不能仅凭同名进程把其他窗口当作WorkBuddy。
        return [string]$Process.Product -ieq 'WorkBuddy' -and [string]$Process.Company -ieq 'Tencent Technology (Shenzhen) Company Limited'
    } catch { return $false }
}

function Test-WorkBuddyExecutable([string]$Executable) {
    try {
        if (-not [IO.Path]::IsPathRooted($Executable) -or [IO.Path]::GetFileName($Executable) -ine 'WorkBuddy.exe' -or -not [IO.File]::Exists($Executable)) { return $false }
        $startupVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($Executable)
        return $startupVersion.ProductName -ieq 'WorkBuddy' -and $startupVersion.CompanyName -ieq 'Tencent Technology (Shenzhen) Company Limited'
    } catch { return $false }
}

function Get-RegisteredWorkBuddyExecutable {
    try {
        # 只读本插件的安装登记，不扫描应用配置、用户会话或登录数据。
        if (-not $env:DSH_HOME -or -not [IO.Path]::IsPathRooted($env:DSH_HOME)) { return $null }
        $startupStamp = Get-Item -LiteralPath (Join-Path $env:DSH_HOME 'workbuddy-plugin/.codex-pet-workbuddy.json') -ErrorAction Stop
        if ($startupStamp.PSIsContainer -or $startupStamp.Length -gt 65536 -or ($startupStamp.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $null }
        $startupRecord = [IO.File]::ReadAllText($startupStamp.FullName) | ConvertFrom-Json -ErrorAction Stop
        if ($startupRecord.schemaVersion -ne 1 -or -not (Test-WorkBuddyExecutable ([string]$startupRecord.workBuddyExe))) { return $null }
        return [IO.Path]::GetFullPath([string]$startupRecord.workBuddyExe)
    } catch { return $null }
}

function Get-WorkBuddyWindow {
    $startupKnownIds = [uint32[]]@(Get-Process -Name 'WorkBuddy' -ErrorAction SilentlyContinue | Where-Object { Test-WorkBuddyProcess $_ } | ForEach-Object { [uint32]$_.Id })
    if (-not $startupKnownIds.Length) { return [IntPtr]::Zero }
    return [CodexPet.WorkBuddyTarget]::Find($startupKnownIds)
}

function Restore-WorkBuddyWindow {
    $startupProcesses = @(Get-Process -Name 'WorkBuddy' -ErrorAction SilentlyContinue)
    $startupExecutable = $null
    foreach ($startupCandidate in @($startupProcesses | Where-Object { Test-WorkBuddyProcess $_ })) {
        try {
            # 启动前重查PID和磁盘产品指纹，不使用过期路径或任意协议。
            $startupCurrent = Get-Process -Id $startupCandidate.Id -ErrorAction Stop
            if ((Test-WorkBuddyProcess $startupCurrent) -and (Test-WorkBuddyExecutable ([string]$startupCurrent.Path))) { $startupExecutable = [string]$startupCurrent.Path; break }
        } catch { # 进程刚退出时不凭旧路径启动另一个程序。
        }
    }
    if (-not $startupExecutable -and $startupProcesses.Length -eq 0) { $startupExecutable = Get-RegisteredWorkBuddyExecutable }
    if (-not $startupExecutable -or -not (Test-WorkBuddyExecutable $startupExecutable)) { return [IntPtr]::Zero }
    # 只有明确Focus请求走此分支；恢复用户要交互的应用首页，不启动后台服务。
    Start-Process -FilePath $startupExecutable -WorkingDirectory ([IO.Path]::GetDirectoryName($startupExecutable)) -WindowStyle Normal | Out-Null
    for ($startupAttempt = 0; $startupAttempt -lt 20; $startupAttempt++) {
        Start-Sleep -Milliseconds 150
        $startupRestored = Get-WorkBuddyWindow
        if ($startupRestored -ne [IntPtr]::Zero) { return $startupRestored }
    }
    return [IntPtr]::Zero
}

try {
    if ($Action -eq 'Alive') {
        # 存活检查不加载Win32，也不受最小化、前后台或窗口尺寸影响。
        $startupUnknown = $false
        foreach ($startupProcess in @(Get-Process -Name 'WorkBuddy' -ErrorAction SilentlyContinue)) {
            if (Test-WorkBuddyProcess $startupProcess) { '{"ok":true,"running":true}'; return }
            try {
                if (-not [string]$startupProcess.Path -or -not [string]$startupProcess.Product -or -not [string]$startupProcess.Company) { $startupUnknown = $true }
            } catch { $startupUnknown = $true }
        }
        if ($startupUnknown) { '{"ok":false,"running":false}' } else { '{"ok":true,"running":false}' }
        return
    }
    # 仅使用进程指纹与Win32几何信息，不读取窗口标题、客户区内容或登录数据。
    if (-not ('CodexPet.WorkBuddyTarget' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace CodexPet {
    public static class WorkBuddyTarget {
        private delegate bool WindowVisitor(IntPtr window, IntPtr parameter);
        [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
        public sealed class Bounds { public int x, y, width, height; }
        [DllImport("user32.dll")] private static extern bool EnumWindows(WindowVisitor visitor, IntPtr parameter);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
        [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
        [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window, out Rect rect);
        [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window, ref Point point);
        [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
        public static uint ForegroundProcessId() { return ProcessId(GetForegroundWindow()); }
        public static uint ProcessId(IntPtr window) { uint process; GetWindowThreadProcessId(window, out process); return process; }
        public static bool UsePhysicalCoordinates() {
            try {
                if (SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return true;
                return SetThreadDpiAwarenessContext(new IntPtr(-3)) != IntPtr.Zero;
            } catch (EntryPointNotFoundException) { return false; }
        }
        public static Bounds ReadBounds(IntPtr window) {
            Rect rect; Point origin = new Point();
            if (!GetClientRect(window, out rect) || !ClientToScreen(window, ref origin)) return null;
            return new Bounds { x = origin.X, y = origin.Y, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top };
        }
        public static IntPtr Find(uint[] processes) {
            var allowed = new HashSet<uint>(processes); IntPtr selected = IntPtr.Zero;
            EnumWindows(delegate(IntPtr window, IntPtr unused) {
                if (!allowed.Contains(ProcessId(window)) || !IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero || (GetWindowLong(window, -20) & 0x80) != 0) return true;
                int cloaked;
                if (DwmGetWindowAttribute(window, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
                Bounds bounds = ReadBounds(window);
                if (bounds == null || bounds.width < 450 || bounds.height < 280) return true;
                selected = window; return false;
            }, IntPtr.Zero);
            return selected;
        }
        public static bool Ready(IntPtr window) {
            IntPtr result;
            return IsWindowVisible(window) && !IsIconic(window) && SendMessageTimeout(window, 0, IntPtr.Zero, IntPtr.Zero, 2, 80, out result) != IntPtr.Zero;
        }
        public static bool Focus(IntPtr window) {
            if (IsIconic(window)) ShowWindow(window, 9);
            SetForegroundWindow(window);
            return GetForegroundWindow() == window;
        }
    }
}
'@ | Out-Null
    }
    if ($Action -eq 'Foreground') {
        $startupForegroundId = [CodexPet.WorkBuddyTarget]::ForegroundProcessId()
        if (-not $startupForegroundId) { '{"ok":false,"isWorkBuddyForeground":false}'; return }
        $startupForeground = Get-Process -Id $startupForegroundId -ErrorAction Stop
        [ordered]@{ ok=$true; isWorkBuddyForeground=[bool](Test-WorkBuddyProcess $startupForeground) } | ConvertTo-Json -Compress
        return
    }
    # 仅设置当前helper线程的DPI上下文，使返回坐标始终为物理像素，不改系统缩放。
    if (-not [CodexPet.WorkBuddyTarget]::UsePhysicalCoordinates()) { '{"ok":false,"ready":false}'; return }
    $startupWindow = Get-WorkBuddyWindow
    if ($startupWindow -eq [IntPtr]::Zero -and $Action -eq 'Focus') { $startupWindow = Restore-WorkBuddyWindow }
    if ($startupWindow -eq [IntPtr]::Zero) { '{"ok":true,"ready":false}'; return }
    # 聚焦前再次确认当前窗口所属进程，避免使用过期的进程或窗口句柄。
    $startupOwner = Get-Process -Id ([CodexPet.WorkBuddyTarget]::ProcessId($startupWindow)) -ErrorAction Stop
    if (-not (Test-WorkBuddyProcess $startupOwner)) { '{"ok":false,"ready":false}'; return }
    $startupFocused = $false
    if ($Action -eq 'Focus') { $startupFocused = [CodexPet.WorkBuddyTarget]::Focus($startupWindow) }
    $startupReady = [CodexPet.WorkBuddyTarget]::Ready($startupWindow)
    $startupBounds = if ([CodexPet.WorkBuddyTarget]::IsIconic($startupWindow)) { $null } else { [CodexPet.WorkBuddyTarget]::ReadBounds($startupWindow) }
    $startupResult = [ordered]@{ ok = $true; ready = [bool]$startupReady }
    if ($startupBounds) { $startupResult.bounds = [ordered]@{ x=$startupBounds.x; y=$startupBounds.y; width=$startupBounds.width; height=$startupBounds.height } }
    if ($Action -eq 'Focus') { $startupResult.focused = [bool]$startupFocused }
    $startupResult | ConvertTo-Json -Compress -Depth 3
} catch {
    # 不输出进程、路径、标题或异常，只给演出层固定的失败形状。
    if ($Action -eq 'Foreground') { '{"ok":false,"isWorkBuddyForeground":false}' } elseif ($Action -eq 'Alive') { '{"ok":false,"running":false}' } else { '{"ok":false,"ready":false}' }
}
