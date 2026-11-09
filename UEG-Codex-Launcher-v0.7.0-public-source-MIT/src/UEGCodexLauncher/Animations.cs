using System.Text.RegularExpressions;

namespace UEGCodexLauncher;

internal record AnimationInfo(string Id, int ButtonCount);

internal static class Animations
{
    internal static string Folder => Path.Combine(AppContext.BaseDirectory, "animation");
    internal static bool ValidId(string? id) => id is "ueg" or "hpc" ||
        id is not null && Regex.IsMatch(id, "^[a-z0-9][a-z0-9_-]{0,40}$");

    internal static string? Find(string id)
    {
        if (id == "hpc")
        {
            string hpc = Path.Combine(AppContext.BaseDirectory, "hpc", "boot.html");
            return File.Exists(hpc) ? hpc : null;
        }
        if (!ValidId(id) || id == "ueg") return null;
        string path = Path.Combine(Folder, id + ".html");
        return IsUsable(path) ? path : null;
    }

    internal static AnimationInfo[] Scan()
    {
        var files = Directory.Exists(Folder) ? Directory.EnumerateFiles(Folder, "*.html") : [];
        var result = files.Select(path => Path.GetFileNameWithoutExtension(path))
            .Where(id => Find(id) is not null)
            .Select(id => new AnimationInfo(id, CountButtons(Find(id)!))).ToList();
        if (Find("hpc") is string hpc) result.Insert(0, new AnimationInfo("hpc", CountButtons(hpc)));
        return result.OrderBy(x => x.Id, StringComparer.Ordinal).ToArray();
    }

    private static bool IsUsable(string path) => File.Exists(path) &&
        (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0 &&
        new FileInfo(path).Length is > 0 and <= 2_000_000;

    private static int CountButtons(string path)
    {
        string html = File.ReadAllText(path);
        html = Regex.Replace(html, "<!--.*?-->|<script\\b[^>]*>.*?</script>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return Regex.Matches(html, "<[^>]+>").Count(match =>
            Regex.IsMatch(match.Value, "^<button\\b|^<input\\b[^>]*\\btype\\s*=\\s*['\"]?(?:button|submit|reset)\\b|\\brole\\s*=\\s*['\"]button['\"]", RegexOptions.IgnoreCase) &&
            !Regex.IsMatch(match.Value, "\\bdisabled\\b", RegexOptions.IgnoreCase));
    }
}
