param(
    [switch]$Watch,
    [ValidateRange(500, 60000)][int]$IntervalMs = 2000,
    [switch]$CompileOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    if (-not ('CodexPet.NativeFullscreen' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace CodexPet {
    public static class NativeFullscreen {
        [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] private struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
        [DllImport("shell32.dll")] private static extern int SHQueryUserNotificationState(out int state);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int maximum);
        [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtrW(IntPtr window, int index);
        [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO value);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetWindowRect(IntPtr window, out RECT rect);
        [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, uint attribute, out RECT value, int size);
        private const string Unknown = "{\"state\":\"unknown\",\"reason\":\"probe-unavailable\"}";
        public static string Query() {
            try {
                int state;
                if (SHQueryUserNotificationState(out state) != 0) return Unknown;
                if (state == 3) return "{\"state\":\"fullscreen\",\"reason\":\"d3d-fullscreen\"}";
                if (state == 1) return "{\"state\":\"unknown\",\"reason\":\"session-unavailable\"}";
                IntPtr window = GetForegroundWindow();
                if (window == IntPtr.Zero || !IsWindowVisible(window) || IsIconic(window)) return Unknown;
                StringBuilder className = new StringBuilder(256);
                if (GetClassName(window, className, className.Capacity) == 0) return Unknown;
                string cls = className.ToString();
                if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd")
                    return "{\"state\":\"windowed\",\"reason\":\"desktop\"}";
                IntPtr previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
                if (previousDpi == IntPtr.Zero) return Unknown;
                try {
                    IntPtr monitor = MonitorFromWindow(window, 2);
                    MONITORINFO info = new MONITORINFO(); info.Size = Marshal.SizeOf(typeof(MONITORINFO));
                    if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return Unknown;
                    RECT rect;
                    if (DwmGetWindowAttribute(window, 9, out rect, Marshal.SizeOf(typeof(RECT))) != 0 && !GetWindowRect(window, out rect)) return Unknown;
                    if (GetForegroundWindow() != window) return Unknown;
                    long style = GetWindowLongPtrW(window, -16).ToInt64();
                    bool borderless = (style & 0x00C00000L) == 0;
                    bool covers = rect.Left <= info.Monitor.Left + 2 && rect.Top <= info.Monitor.Top + 2 && rect.Right >= info.Monitor.Right - 2 && rect.Bottom >= info.Monitor.Bottom - 2;
                    if (borderless && covers) return "{\"state\":\"fullscreen\",\"reason\":\"borderless-fullscreen\"}";
                    return "{\"state\":\"windowed\",\"reason\":\"not-fullscreen\"}";
                } finally { SetThreadDpiAwarenessContext(previousDpi); }
            } catch { return Unknown; }
        }
    }
}
'@ | Out-Null
    }
    if ($CompileOnly) {
        '{"state":"unknown","reason":"compile-only"}'
        exit 0
    }
    # 只读当前窗口的类与物理边界，不读取标题、正文、进程清单或登录信息。
    do {
        [Console]::Out.WriteLine([CodexPet.NativeFullscreen]::Query())
        [Console]::Out.Flush()
        if (-not $Watch) { break }
        Start-Sleep -Milliseconds $IntervalMs
    } while ($true)
} catch {
    # 故障只返回固定枚举，由主进程保留上次可见性并退避重试。
    [Console]::Out.WriteLine('{"state":"unknown","reason":"probe-unavailable"}')
}
