using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace UEGCodexLauncher;

// All candidate windows are checked against an explicit application identity.
// We never use a window-title-only or an arbitrary 'largest window' heuristic.
internal static class CodexWindowManager
{
    internal readonly record struct Candidate(nint Handle, int ProcessId, string ProcessName, string Title);
    private const int SwRestore = 9;
    private const uint GwOwner = 4;
    private const int ErrorInsufficientBuffer = 122;

    internal static bool TryValidate(CodexConfig config, string baseDir, out string error)
    {
        error = "";
        var mode = (config.Mode ?? "previewOnly").Trim().ToLowerInvariant();
        if (mode == "previewonly") return true;
        if (mode != "exe" && mode != "shortcut" && mode != "aumid")
        {
            error = "codex.mode must be previewOnly, exe, shortcut, or aumid";
            return false;
        }
        if (string.IsNullOrWhiteSpace(config.Target))
        {
            error = "Specify the actual installed Codex target; do not guess an AUMID or executable path.";
            return false;
        }
        if (mode == "aumid" && !Regex.IsMatch(config.Target.Trim(), @"^[A-Za-z0-9_.!\-]{3,200}$"))
        {
            error = "Invalid AUMID format";
            return false;
        }
        if (mode == "aumid")
        {
            var result = SHParseDisplayName(@"shell:AppsFolder\" + config.Target.Trim(), 0, out var item, 0, out _);
            Marshal.FreeCoTaskMem(item);
            if (result < 0 || item == 0)
            {
                error = "Codex AUMID not found in the Windows Apps folder.";
                return false;
            }
        }
        if (mode is "exe" or "shortcut")
        {
            string path = ResolveTargetPath(config.Target, baseDir);
            string extension = mode == "exe" ? ".exe" : ".lnk";
            if (!path.EndsWith(extension, StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
            {
                error = "No verified Codex " + extension + " exists at: " + path;
                return false;
            }
        }
        if (mode != "exe" && (config.WindowProcessNames is null || config.WindowProcessNames.Length == 0))
        {
            error = "For shortcut/aumid, set codex.windowProcessNames from your actual Codex process (not explorer.exe).";
            return false;
        }
        var names = GetExpectedNames(config);
        string[] unsafeHosts = ["explorer", "ApplicationFrameHost", "msedgewebview2", "dllhost", "svchost"];
        if (names.Length == 0 || names.Any(n => !Regex.IsMatch(n, @"^[A-Za-z0-9_.-]{1,90}$")) ||
            names.Any(n => unsafeHosts.Contains(n, StringComparer.OrdinalIgnoreCase)))
        {
            error = "codex.windowProcessNames must contain exact process names without .exe, not wildcards.";
            return false;
        }
        if (config.ReadyTimeoutSeconds < 5 || config.ReadyTimeoutSeconds > 180)
        {
            error = "codex.readyTimeoutSeconds must be 5 through 180.";
            return false;
        }
        return true;
    }

    internal static string ResolveTargetPath(string path, string baseDir) =>
        Path.IsPathRooted(path) ? Path.GetFullPath(path) : Path.GetFullPath(Path.Combine(baseDir, path));

    private static string[] GetExpectedNames(CodexConfig config)
    {
        var names = (config.WindowProcessNames ?? Array.Empty<string>())
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Select(n => n.Trim())
            .ToArray();
        if (names.Length == 0 && config.Mode.Equals("exe", StringComparison.OrdinalIgnoreCase))
            names = [Path.GetFileNameWithoutExtension(config.Target.Trim())];
        return names;
    }

    internal static Candidate? Find(CodexConfig config, string baseDir)
    {
        var names = GetExpectedNames(config);
        Candidate? match = null;
        // EnumWindows only scans this desktop's top-level windows; no system-wide process manipulation.
        EnumWindows((hwnd, _) =>
        {
            if (match is not null || !IsWindowVisible(hwnd) || GetWindow(hwnd, GwOwner) != nint.Zero)
                return true;
            if (GetWindowTextLength(hwnd) <= 0 || !GetWindowRect(hwnd, out var rect)) return true;
            // A minimized legitimate window can have tiny/off-screen coordinates.
            if (!IsIconic(hwnd) && (rect.Right - rect.Left < 300 || rect.Bottom - rect.Top < 200)) return true;
            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == 0 || pid == Environment.ProcessId) return true;
            try
            {
                using var process = Process.GetProcessById(checked((int)pid));
                if (!names.Contains(process.ProcessName, StringComparer.OrdinalIgnoreCase)) return true;
                var mode = config.Mode.Trim().ToLowerInvariant();
                if (mode == "exe" &&
                    !string.Equals(process.MainModule?.FileName, ResolveTargetPath(config.Target, baseDir),
                        StringComparison.OrdinalIgnoreCase)) return true;
                // For packaged apps, an available AUMID must match. No title-only fallback.
                if (mode == "aumid" && config.Target.Contains('!'))
                {
                    var actualAumid = GetProcessAumid(process.Handle);
                    if (!string.Equals(actualAumid, config.Target.Trim(), StringComparison.OrdinalIgnoreCase)) return true;
                }
                var buffer = new StringBuilder(GetWindowTextLength(hwnd) + 1);
                GetWindowText(hwnd, buffer, buffer.Capacity);
                var title = buffer.ToString();
                if (!string.IsNullOrWhiteSpace(config.WindowTitleContains) &&
                    !title.Contains(config.WindowTitleContains, StringComparison.OrdinalIgnoreCase)) return true;
                match = new Candidate(hwnd, (int)pid, process.ProcessName, title);
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                // A process exited, or its path was inaccessible. Reject rather than guessing.
            }
            return true;
        }, nint.Zero);
        return match;
    }

    internal static async Task<Candidate?> WaitForReadyAsync(CodexConfig config, string baseDir, TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var watch = Stopwatch.StartNew();
        nint lastHandle = nint.Zero;
        int stableSamples = 0;
        while (watch.Elapsed < timeout)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var candidate = Find(config, baseDir);
            if (candidate is not null)
            {
                stableSamples = candidate.Value.Handle == lastHandle ? stableSamples + 1 : 1;
                lastHandle = candidate.Value.Handle;
                if (stableSamples >= 2) return candidate;
            }
            else { lastHandle = nint.Zero; stableSamples = 0; }
            await Task.Delay(250, cancellationToken);
        }
        return null;
    }

    internal static async Task<bool> TryForegroundAsync(CodexConfig config, string baseDir,
        Candidate candidate, CancellationToken token)
    {
        // A window handle can be reused. Re-validate its owner before switching focus.
        var current = Find(config, baseDir);
        if (current is null || current.Value.Handle != candidate.Handle ||
            current.Value.ProcessId != candidate.ProcessId) return false;
        if (IsIconic(candidate.Handle)) ShowWindowAsync(candidate.Handle, SwRestore);
        SetForegroundWindow(candidate.Handle);
        await Task.Delay(250, token);
        // Windows sometimes refuses foreground requests by design. Do not declare success then.
        return GetForegroundWindow() == candidate.Handle;
    }

    private static string? GetProcessAumid(nint processHandle)
    {
        uint required = 0;
        if (GetApplicationUserModelId(processHandle, ref required, null) != ErrorInsufficientBuffer ||
            required == 0 || required > 512) return null;
        var buffer = new StringBuilder((int)required);
        return GetApplicationUserModelId(processHandle, ref required, buffer) == 0 ? buffer.ToString() : null;
    }

    private delegate bool EnumWindowsProc(nint hwnd, nint param);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SHParseDisplayName(string name, nint bindContext, out nint item, uint attributes, out uint actual);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, nint param);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")] private static extern nint GetWindow(nint hwnd, uint command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(nint hwnd, StringBuilder buffer, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(nint hwnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(nint hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern int GetApplicationUserModelId(
        nint processHandle, ref uint length, StringBuilder? applicationUserModelId);

    [StructLayout(LayoutKind.Sequential)] private struct Rect
    {
        internal int Left, Top, Right, Bottom;
    }
}
