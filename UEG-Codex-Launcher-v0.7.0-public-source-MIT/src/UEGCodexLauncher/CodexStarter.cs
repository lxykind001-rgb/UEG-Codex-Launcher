using System.Diagnostics;
using System.Text.RegularExpressions;

namespace UEGCodexLauncher;

internal static class CodexStarter
{
    public static bool TryStart(CodexConfig config, string baseDir, out string error)
    {
        error = "";
        string mode = (config.Mode ?? "previewOnly").Trim().ToLowerInvariant();
        if (mode == "previewonly") return false;
        try
        {
            ProcessStartInfo info;
            switch (mode)
            {
                case "shortcut":
                case "exe":
                    if (string.IsNullOrWhiteSpace(config.Target))
                        throw new InvalidOperationException("Codex target not configured");
                    string path = Path.IsPathRooted(config.Target) ? config.Target : Path.GetFullPath(Path.Combine(baseDir, config.Target));
                    string requiredExt = mode == "shortcut" ? ".lnk" : ".exe";
                    if (!path.EndsWith(requiredExt, StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
                        throw new FileNotFoundException("Expected existing " + requiredExt + " file", path);
                    info = new ProcessStartInfo { FileName = path, UseShellExecute = true };
                    break;
                case "aumid":
                    string appId = (config.Target ?? "").Trim();
                    // Permit only AppUserModelID characters, no shell command fragments.
                    if (!Regex.IsMatch(appId, @"^[a-zA-Z0-9_.!\-]{3,200}$"))
                        throw new InvalidOperationException("Invalid AUMID; copy the exact AppID from Get-StartApps");
                    info = new ProcessStartInfo
                    {
                        FileName = "explorer.exe",
                        Arguments = "shell:AppsFolder\\" + appId,
                        UseShellExecute = true
                    };
                    break;
                default:
                    throw new InvalidOperationException("Unknown launch mode: " + mode);
            }
            using var started = Process.Start(info);
            if (started is null) throw new InvalidOperationException("Windows rejected the launch request");
            return true; // OS accepted activation; NOT proof that the Codex window rendered.
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }
}
