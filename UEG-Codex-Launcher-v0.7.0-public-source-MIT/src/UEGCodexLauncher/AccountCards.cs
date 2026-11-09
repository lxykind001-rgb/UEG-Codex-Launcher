using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace UEGCodexLauncher;

internal sealed record CardProfile(string Key, string Label, string EmailHint);
internal sealed record NextCard(string Key, string BoundKey);

internal static class AccountCards
{
    internal const string DesktopAppId = "OpenAI.Codex_2p2nqsd0c76g0!App";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // null means the official service returned no ChatGPT identity. Errors remain distinct.
    internal static async Task<string?> ReadEmailAsync(CancellationToken lifetime)
    {
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application", true)!)!;
        dynamic? app = shell.NameSpace("shell:AppsFolder").ParseName(DesktopAppId);
        string? package = app?.ExtendedProperty("System.AppUserModel.PackageInstallPath");
        if (string.IsNullOrEmpty(package)) throw new IOException("未找到官方桌面应用包");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var helper = new Process { StartInfo = new ProcessStartInfo(
            Path.Combine(package, "app", "resources", "codex.exe"), "app-server --listen stdio://")
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8
        }};
        helper.Start();
        helper.BeginErrorReadLine(); // Drain diagnostics without logging account information.
        try
        {
            await helper.StandardInput.WriteLineAsync("""{"id":1,"method":"initialize","params":{"clientInfo":{"name":"ueg_launcher","version":"0.6.0"}}}""");
            await ReplyAsync(helper, 1, timeout.Token);
            await helper.StandardInput.WriteLineAsync("""{"method":"initialized","params":{}}""");
            await helper.StandardInput.WriteLineAsync("""{"id":2,"method":"account/read","params":{"refreshToken":false}}""");
            var account = (await ReplyAsync(helper, 2, timeout.Token)).GetProperty("account");
            if (account.ValueKind == JsonValueKind.Null || account.GetProperty("type").GetString() != "chatgpt")
                return null;
            return account.GetProperty("email").GetString()?.Trim();
        }
        finally
        {
            helper.StandardInput.Close();
            if (!helper.HasExited && !helper.WaitForExit(100))
                try { helper.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
        }
    }

    private static async Task<JsonElement> ReplyAsync(Process helper, int id, CancellationToken token)
    {
        while (await helper.StandardOutput.ReadLineAsync(token) is string line)
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (root.TryGetProperty("id", out var value) && value.ValueKind == JsonValueKind.Number && value.GetInt32() == id)
                return root.TryGetProperty("result", out var result) ? result.Clone() : throw new IOException("账户服务查询失败");
        }
        throw new EndOfStreamException();
    }

    private static string KeyFor(string email)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        var key = SHA256.HashData(Encoding.UTF8.GetBytes(email.Trim().ToLowerInvariant()));
        return Convert.ToHexString(key);
    }

    private static string CardFile(string folder, string email) => Path.Combine(folder, KeyFor(email) + ".json");
    private static string IndexFile(string folder) => Path.Combine(folder, "profiles.json");
    private static string NextFile(string folder) => Path.Combine(folder, "next-card.json");
    private static bool ValidKey(string key) => key.Length == 64 && key.All(Uri.IsHexDigit);
    private static List<CardProfile> ReadIndex(string folder) => File.Exists(IndexFile(folder))
        ? JsonSerializer.Deserialize<List<CardProfile>>(File.ReadAllText(IndexFile(folder)), Json) ?? throw new InvalidDataException("身份卡索引为空")
        : new();
    private static void WriteIndex(string folder, List<CardProfile> profiles)
    {
        string temp = IndexFile(folder) + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temp, JsonSerializer.Serialize(profiles, Json)); File.Move(temp, IndexFile(folder), true); }
        finally { File.Delete(temp); }
    }
    private static void RequireCurrent(string boundEmail, string? currentEmail)
    {
        if (string.IsNullOrWhiteSpace(currentEmail) || !string.Equals(boundEmail, currentEmail, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("账户已切换，请重新打开角色设置");
    }

    internal static OperatorConfig Load(string folder, string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return new();
        var file = CardFile(folder, email);
        return File.Exists(file) ? JsonSerializer.Deserialize<OperatorConfig>(File.ReadAllText(file), Json)
            ?? throw new InvalidDataException("无法读取角色卡") : new();
    }

    internal static void Save(string folder, string boundEmail, string? currentEmail, OperatorConfig card)
    {
        RequireCurrent(boundEmail, currentEmail);
        if (card.Label is null || card.Label.Length > 40 || card.Name is null || card.Name.Length > 80 ||
            new[]{card.Id,card.En,card.Post,card.Level,card.Issuer,card.Valid,card.Scope,card.Bio}.Any(v=>v is null || v.Length>180))
            throw new InvalidDataException("姓名最多 80 字，其他字段最多 180 字");
        if (!string.IsNullOrEmpty(card.Photo))
        {
            var comma = card.Photo.IndexOf(',');
            if (comma < 0 || card.Photo.Length > 534000 ||
                card.Photo[..comma] is not ("data:image/png;base64" or "data:image/jpeg;base64" or "data:image/webp;base64"))
                throw new InvalidDataException("头像须为 400 KB 以内的 PNG、JPEG 或 WebP 图片");
            var data = Convert.FromBase64String(card.Photo[(comma + 1)..]);
            if (data.Length is 0 or > 400000) throw new InvalidDataException("头像大小超出范围");
        }
        Directory.CreateDirectory(folder);
        var file = CardFile(folder, currentEmail!);
        var temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(card, Json));
            File.Move(temp, file, overwrite: true);
        }
        finally { File.Delete(temp); }
        var profiles = ReadIndex(folder);
        var key = KeyFor(currentEmail!);
        var name = string.IsNullOrWhiteSpace(card.Label) ? (string.IsNullOrWhiteSpace(card.Name) ? "身份卡" : card.Name.Trim()) : card.Label.Trim();
        var hint = currentEmail!.Trim()[..1] + "***";
        profiles.RemoveAll(profile => profile.Key == key);
        profiles.Add(new CardProfile(key, name, hint));
        WriteIndex(folder, profiles);
    }

    internal static CardProfile[] ListProfiles(string folder, string? currentEmail)
    {
        var profiles = ReadIndex(folder).Where(profile => ValidKey(profile.Key) && File.Exists(Path.Combine(folder, profile.Key + ".json"))).ToList();
        if (!string.IsNullOrWhiteSpace(currentEmail))
        {
            var key = KeyFor(currentEmail);
            if (File.Exists(CardFile(folder, currentEmail!)) && profiles.All(profile => profile.Key != key))
            {
                var card = Load(folder, currentEmail);
                profiles.Add(new CardProfile(key, string.IsNullOrWhiteSpace(card.Label) ? (string.IsNullOrWhiteSpace(card.Name) ? "身份卡" : card.Name) : card.Label, currentEmail.Trim()[..1] + "***"));
                WriteIndex(folder, profiles);
            }
        }
        return profiles.ToArray();
    }

    internal static string QueuedKey(string folder, string? currentEmail)
    {
        if (string.IsNullOrWhiteSpace(currentEmail) || !File.Exists(NextFile(folder))) return "";
        var next = JsonSerializer.Deserialize<NextCard>(File.ReadAllText(NextFile(folder)), Json);
        return next is not null && next.BoundKey == KeyFor(currentEmail) && ValidKey(next.Key) &&
            ListProfiles(folder, currentEmail).Any(profile => profile.Key == next.Key) ? next.Key : "";
    }

    internal static void Queue(string folder, string boundEmail, string? currentEmail, string key)
    {
        RequireCurrent(boundEmail, currentEmail);
        if (key == "") { File.Delete(NextFile(folder)); return; }
        if (!ValidKey(key) || ListProfiles(folder, currentEmail).All(profile => profile.Key != key))
            throw new InvalidDataException("请选择已保存的身份卡");
        Directory.CreateDirectory(folder);
        var temp = NextFile(folder) + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temp, JsonSerializer.Serialize(new NextCard(key, KeyFor(currentEmail!)), Json)); File.Move(temp, NextFile(folder), true); }
        finally { File.Delete(temp); }
    }

    internal static OperatorConfig LoadForLaunch(string folder, string? currentEmail)
    {
        var nextFile = NextFile(folder);
        if (!File.Exists(nextFile)) return Load(folder, currentEmail);
        var claim = nextFile + "." + Guid.NewGuid().ToString("N") + ".take";
        try { File.Move(nextFile, claim); }
        catch (FileNotFoundException) { return Load(folder, currentEmail); }
        try
        {
            var next = JsonSerializer.Deserialize<NextCard>(File.ReadAllText(claim), Json);
            if (next is not null && !string.IsNullOrWhiteSpace(currentEmail) && next.BoundKey == KeyFor(currentEmail) &&
                ValidKey(next.Key) && File.Exists(Path.Combine(folder, next.Key + ".json")))
                return JsonSerializer.Deserialize<OperatorConfig>(File.ReadAllText(Path.Combine(folder, next.Key + ".json")), Json)
                    ?? throw new InvalidDataException("无法读取角色卡");
            return Load(folder, currentEmail);
        }
        finally { File.Delete(claim); }
    }

    internal static void Reset(string folder, string boundEmail, string? currentEmail, string key)
    {
        RequireCurrent(boundEmail, currentEmail);
        if (!ValidKey(key) || ListProfiles(folder, currentEmail).All(profile => profile.Key != key))
            throw new InvalidDataException("请选择已保存的身份卡");
        File.Delete(Path.Combine(folder, key + ".json"));
        var profiles = ReadIndex(folder);
        profiles.RemoveAll(profile => profile.Key == key);
        WriteIndex(folder, profiles);
        if (QueuedKey(folder, currentEmail) == "") File.Delete(NextFile(folder));
    }
}
