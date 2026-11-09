using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace UEGCodexLauncher;

internal static class BootCover
{
    internal static void Prepare(Window overlay)
    {
        var window = new WindowInteropHelper(overlay).Handle;
        int disabled = 1, square = 1, noBorder = -2;
        DwmSetWindowAttribute(window, 3, ref disabled, 4); // Disable native show/close transitions.
        DwmSetWindowAttribute(window, 33, ref square, 4);
        DwmSetWindowAttribute(window, 34, ref noBorder, 4);
    }

    internal static bool Owns(nint window, int processId)
    {
        GetWindowThreadProcessId(window, out var actual);
        return actual == processId && IsWindowVisible(window);
    }

    internal static void Restore(nint window)
    {
        if (IsIconic(window)) ShowWindowAsync(window, 9);
    }

    internal static void Place(Window overlay, nint target, bool fullscreen)
    {
        var window = new WindowInteropHelper(overlay).Handle;
        if (!fullscreen && (target == 0 || IsIconic(target))) return;
        var monitor = MonitorFromWindow(target == 0 ? window : target, 2);
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(monitor, ref info) || !GetWindowRect(window, out var current)) return;
        var screen = info.Screen;
        if (!fullscreen)
        {
            if (DwmGetWindowAttribute(target, 9, out screen, Marshal.SizeOf<Rect>()) != 0 &&
                !GetWindowRect(target, out screen)) return;
        }
        if (!screen.Equals(current))
            SetWindowPos(window, 0, screen.Left, screen.Top, screen.Right - screen.Left,
                screen.Bottom - screen.Top, 0x14); // Preserve z-order and keyboard focus.
    }

    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Screen, Work; public uint Flags; }
    [DllImport("user32.dll")] private static extern nint MonitorFromWindow(nint hwnd, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(nint hwnd, nint after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(nint hwnd, int command);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(nint hwnd, int attribute, ref int value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint hwnd, int attribute, out Rect value, int size);
}
