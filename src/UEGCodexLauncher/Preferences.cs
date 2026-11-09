using System.Text.Json;

namespace UEGCodexLauncher;

internal sealed class Preferences
{
    public string Display { get; set; } = "app";
    public string Language { get; set; } = "zh-en";
    public string Animation { get; set; } = "ueg";
    internal static string Folder => Environment.GetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER") ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UEGCodexLauncher", "WebView2");
    private static string FilePath => Path.Combine(Folder, "preferences.json");

    internal void Validate()
    {
        if (Display is not ("app" or "fullscreen") || Language is not ("zh-en" or "en") ||
            !Animations.ValidId(Animation))
            throw new InvalidDataException("请选择有效的覆盖方式、字幕语言和动画");
    }
    internal static Preferences Load()
    {
        var value = File.Exists(FilePath) ? JsonSerializer.Deserialize<Preferences>(File.ReadAllText(FilePath), AccountCards.Json)
            ?? throw new InvalidDataException("启动设置为空") : new();
        value.Validate();
        return value;
    }
    internal void Save()
    {
        Validate();
        Directory.CreateDirectory(Folder);
        string temp = FilePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temp, JsonSerializer.Serialize(this, AccountCards.Json)); File.Move(temp, FilePath, true); }
        finally { File.Delete(temp); }
    }
}
