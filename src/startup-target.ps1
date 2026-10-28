[CmdletBinding()]
param([ValidateSet('Probe', 'Focus')][string]$Action = 'Probe')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Test-StartupCodexProcess($Process) {
    try {
        $startupPath = [string]$Process.Path
        if (-not $startupPath -or [IO.Path]::GetFileName($startupPath) -notmatch '^(?i:ChatGPT|Codex)\.exe$') { return $false }
        if ($startupPath -match '(?i)[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]') { return $true }
        $startupProduct = [Diagnostics.FileVersionInfo]::GetVersionInfo($startupPath).ProductName
        return $startupProduct -ieq 'Codex' -or $startupProduct -ieq 'OpenAI Codex'
    } catch { return $false }
}

try {
    # 仅使用进程指纹与Win32几何信息，不读取窗口标题、客户区内容或登录数据。
    if (-not ('CodexPet.StartupTarget' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace CodexPet {
    public static class StartupTarget {
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
    # 仅设置当前helper线程的DPI上下文，使返回坐标始终为物理像素，不改系统缩放。
    if (-not [CodexPet.StartupTarget]::UsePhysicalCoordinates()) { '{"ok":false,"ready":false}'; return }
    $startupIds = [uint32[]]@(
        Get-Process -Name 'ChatGPT', 'Codex' -ErrorAction SilentlyContinue |
            Where-Object { Test-StartupCodexProcess $_ } | ForEach-Object { [uint32]$_.Id }
    )
    if (-not $startupIds.Length) { '{"ok":true,"ready":false}'; return }
    $startupWindow = [CodexPet.StartupTarget]::Find($startupIds)
    if ($startupWindow -eq [IntPtr]::Zero) { '{"ok":true,"ready":false}'; return }
    # 聚焦前再次确认当前窗口所属进程，避免使用过期的进程或窗口句柄。
    $startupOwner = Get-Process -Id ([CodexPet.StartupTarget]::ProcessId($startupWindow)) -ErrorAction Stop
    if (-not (Test-StartupCodexProcess $startupOwner)) { '{"ok":false,"ready":false}'; return }
    $startupFocused = $false
    if ($Action -eq 'Focus') { $startupFocused = [CodexPet.StartupTarget]::Focus($startupWindow) }
    $startupReady = [CodexPet.StartupTarget]::Ready($startupWindow)
    $startupBounds = if ([CodexPet.StartupTarget]::IsIconic($startupWindow)) { $null } else { [CodexPet.StartupTarget]::ReadBounds($startupWindow) }
    $startupResult = [ordered]@{ ok = $true; ready = [bool]$startupReady }
    if ($startupBounds) { $startupResult.bounds = [ordered]@{ x=$startupBounds.x; y=$startupBounds.y; width=$startupBounds.width; height=$startupBounds.height } }
    if ($Action -eq 'Focus') { $startupResult.focused = [bool]$startupFocused }
    $startupResult | ConvertTo-Json -Compress -Depth 3
} catch {
    # 不输出进程、路径、标题或异常，只给演出层固定的失败形状。
    '{"ok":false,"ready":false}'
}
