using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace UEGCodexLauncher;

internal static class SettingsServer
{
    internal static async Task RunAsync(string endpointFile)
    {
        // Loopback only, random capability in the URL fragment. No account data in URLs/logs.
        var reservation = new TcpListener(IPAddress.Loopback, 0);
        reservation.Start();
        int port = ((IPEndPoint)reservation.LocalEndpoint).Port;
        reservation.Stop();
        string origin = $"http://127.0.0.1:{port}";
        string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        using var listener = new HttpListener();
        listener.Prefixes.Add(origin + "/");
        listener.Start();
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(endpointFile))!);
        File.WriteAllText(endpointFile, JsonSerializer.Serialize(new { url = origin + "/#" + token, pid = Environment.ProcessId }));
        while (true)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync().WaitAsync(TimeSpan.FromMinutes(30)); }
            catch (TimeoutException) { break; }
            var request = context.Request;
            var response = context.Response;
            response.Headers["Cache-Control"] = "no-store";
            response.Headers["X-Content-Type-Options"] = "nosniff";
            response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
            try
            {
                string route = request.Url!.AbsolutePath;
                if (request.Url.Authority != $"127.0.0.1:{port}") throw new InvalidDataException("Invalid host");
                if (route.StartsWith("/api", StringComparison.Ordinal))
                {
                    if (request.Headers["Authorization"] != "Bearer " + token ||
                        (request.Headers["Origin"] is string from && from != origin))
                    { response.StatusCode = 403; continue; }
                    object result;
                    if (request.HttpMethod == "GET" && route == "/api")
                    {
                        string? email = null; string message = "角色卡按本机账户服务的邮箱绑定，请核对下方邮箱。";
                        OperatorConfig card = new();
                        try { email = await AccountCards.ReadEmailAsync(CancellationToken.None); card = AccountCards.Load(Path.Combine(Preferences.Folder, "cards"), email); }
                        catch { email = null; message = "暂时无法读取账户或角色卡。角色编辑已锁定，仍可调整显示设置。"; }
                        var folder = Path.Combine(Preferences.Folder, "cards");
                        result = new { email, card, preferences = Preferences.Load(), message,
                            animations = Animations.Scan(), animationFolder = Animations.Folder,
                            profiles = email is null ? Array.Empty<CardProfile>() : AccountCards.ListProfiles(folder, email),
                            nextCardKey = AccountCards.QueuedKey(folder, email) };
                    }
                    else if (request.HttpMethod == "GET" && route == "/api/animations")
                        result = new { animations = Animations.Scan(), animationFolder = Animations.Folder };
                    else if (request.HttpMethod == "POST" && route is "/api/preferences" or "/api/card" or "/api/selection" or "/api/reset")
                    {
                        if (request.ContentType != "application/json" || request.ContentLength64 is < 0 or > 750000)
                            throw new InvalidDataException("Invalid settings request");
                        using var body = await JsonDocument.ParseAsync(request.InputStream);
                        if (route == "/api/preferences")
                        {
                            var preferences = body.RootElement.Deserialize<Preferences>(AccountCards.Json) ?? throw new InvalidDataException();
                            if (preferences.Animation != "ueg" && Animations.Find(preferences.Animation) is null)
                                throw new FileNotFoundException("所选动画文件不存在");
                            preferences.Save();
                        }
                        else if (route == "/api/card")
                        {
                            string email = body.RootElement.GetProperty("email").GetString() ?? "";
                            var card = body.RootElement.GetProperty("card").Deserialize<OperatorConfig>(AccountCards.Json) ?? throw new InvalidDataException();
                            AccountCards.Save(Path.Combine(Preferences.Folder, "cards"), email,
                                await AccountCards.ReadEmailAsync(CancellationToken.None), card);
                        }
                        else
                        {
                            string email = body.RootElement.GetProperty("email").GetString() ?? "";
                            string key = body.RootElement.GetProperty("key").GetString() ?? "";
                            string? current = await AccountCards.ReadEmailAsync(CancellationToken.None);
                            string folder = Path.Combine(Preferences.Folder, "cards");
                            if (route == "/api/selection") AccountCards.Queue(folder, email, current, key);
                            else AccountCards.Reset(folder, email, current, key);
                        }
                        result = new { saved = true };
                    }
                    else { response.StatusCode = 404; continue; }
                    response.ContentType = "application/json; charset=utf-8";
                    await response.OutputStream.WriteAsync(JsonSerializer.SerializeToUtf8Bytes(result, AccountCards.Json));
                }
                else if (request.HttpMethod == "GET" && route is "/" or "/settings.js" or "/settings.css")
                {
                    string name = route == "/" ? "settings.html" : route[1..];
                    response.ContentType = name.EndsWith(".js") ? "text/javascript" : name.EndsWith(".css") ? "text/css" : "text/html; charset=utf-8";
                    await response.OutputStream.WriteAsync(await File.ReadAllBytesAsync(Path.Combine(AppContext.BaseDirectory, "wwwroot", name)));
                }
                else response.StatusCode = 404;
            }
            catch (Exception ex)
            {
                response.StatusCode = 400;
                response.ContentType = "application/json; charset=utf-8";
                await response.OutputStream.WriteAsync(JsonSerializer.SerializeToUtf8Bytes(new { error = ex.Message }));
            }
            finally { response.Close(); }
        }
    }
}
