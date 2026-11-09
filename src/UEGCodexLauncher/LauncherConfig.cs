using System.Text.Json;

namespace UEGCodexLauncher;

public sealed class LauncherConfig
{
    public UegConfig Ueg { get; set; } = new();
    public CodexConfig Codex { get; set; } = new();
    public WindowConfig Window { get; set; } = new();

    public static LauncherConfig Load(string path)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("Missing launcher.config.json", path);
        var config = JsonSerializer.Deserialize<LauncherConfig>(File.ReadAllText(path),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        return config ?? throw new InvalidDataException("launcher.config.json is empty");
    }
}
public sealed class OperatorConfig
{
    public string Label { get; set; } = "";
    public string Name { get; set; } = "";
    public string Photo { get; set; } = "";
    public string Id { get; set; } = "";
    public string En { get; set; } = "";
    public string Post { get; set; } = "";
    public string Level { get; set; } = "";
    public string Issuer { get; set; } = "";
    public string Valid { get; set; } = "";
    public string Scope { get; set; } = "";
    public string Bio { get; set; } = "";
}
public sealed class UegConfig
{
    public bool Autoplay { get; set; } = false;
    public string Voice { get; set; } = "off";
    public string QrPayload { get; set; } = "";
}
public sealed class CodexConfig
{
    // PreviewOnly is default, no client is launched until user configures one explicitly.
    public string Mode { get; set; } = "previewOnly";
    public string Target { get; set; } = "";
    // Exact process name(s) confirmed on this computer using Get-Process. No wildcards.
    public string[] WindowProcessNames { get; set; } = Array.Empty<string>();
    // Optional secondary filter; never used as the only identity check.
    public string WindowTitleContains { get; set; } = "";
    public int ReadyTimeoutSeconds { get; set; } = 75;
}
public sealed class WindowConfig
{
    public int Width { get; set; } = 1280;
    public int Height { get; set; } = 720;
    // Only used in explicit Codex launch mode. Keeps a late-opening app from covering UEG.
    public bool KeepOnTopDuringBoot { get; set; } = true;
}
