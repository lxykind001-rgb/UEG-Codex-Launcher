using System;
using System.Runtime.InteropServices;

// Process.MainWindowHandle omits WPF windows with ShowInTaskbar=false.
public static class UegVisibleWindow
{
    public static IntPtr Find(int processId)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr unused) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId || !IsWindowVisible(window)) return true;
            found = window;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    private delegate bool Callback(IntPtr window, IntPtr unused);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr unused);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
