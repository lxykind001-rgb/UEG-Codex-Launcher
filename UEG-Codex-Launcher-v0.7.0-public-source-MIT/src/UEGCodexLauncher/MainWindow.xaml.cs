using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace UEGCodexLauncher;

public partial class MainWindow : Window
{
    private LauncherConfig _config = new();
    private bool _initialized;
    private bool _uegDone;
    private bool _handoffRunning;
    private bool _previewOnly;
    private bool _bootStarted;
    private bool _hpcReady;
    private bool _hpcTerminal;
    private bool _handoffPending;
    private string _animation = "ueg";
    private string? _animationPage;
    private readonly string _sessionId = Guid.NewGuid().ToString("N");
    private Preferences _preferences = new();
    private CodexWindowManager.Candidate? _coverTarget;
    private bool _finding;
    private string CardFolder => Path.Combine(Browser.CoreWebView2.Environment.UserDataFolder, "cards");
    private readonly System.Windows.Threading.DispatcherTimer _coverTimer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    private readonly System.Windows.Threading.DispatcherTimer _hpcTimer = new() { Interval = TimeSpan.FromSeconds(20) };
    private string _launchError = "";
    private readonly CancellationTokenSource _lifetime = new();
    private const string VirtualOrigin = "https://ueg.local";
    private string AnimationHost => _animation == "hpc" ? "hpc.local" : "animation.local";

    public MainWindow()
    {
        InitializeComponent();
        _config = LauncherConfig.Load(Path.Combine(AppContext.BaseDirectory, "launcher.config.json"));
        _preferences = Preferences.Load();
        _animationPage = Animations.Find(_preferences.Animation);
        _animation = _animationPage is null ? "ueg" : _preferences.Animation;
        if (_animation != "ueg") Title = _animation + " · Codex";
        _previewOnly = string.Equals(_config.Codex.Mode, "previewOnly", StringComparison.OrdinalIgnoreCase);
        Width = Math.Clamp(_config.Window.Width, 900, 3840);
        Height = Math.Clamp(_config.Window.Height, 540, 2160);
        if (!_previewOnly && CodexWindowManager.TryValidate(_config.Codex, AppContext.BaseDirectory, out _launchError))
            _coverTarget = CodexWindowManager.Find(_config.Codex, AppContext.BaseDirectory);
        if (!_previewOnly && _config.Window.KeepOnTopDuringBoot)
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            ShowInTaskbar = false;
            Topmost = true;
            if (_coverTarget is { } target) BootCover.Restore(target.Handle);
        }
        SourceInitialized += (_, _) => { BootCover.Prepare(this); if (Topmost) CoverDesktop(); };
        _coverTimer.Tick += (_, _) => CoverDesktop();
        _hpcTimer.Tick += (_, _) => FallbackToUeg();
        Closed += (_, _) => { _coverTimer.Stop(); _hpcTimer.Stop(); _lifetime.Cancel(); };
    }

    internal async Task ShowStartupAsync()
    {
        // An app-sized cover has no valid position until the target window exists.
        // Start and locate it before Show, so SourceInitialized can place the first frame.
        if (!_previewOnly && Topmost && _preferences.Display == "app" &&
            _coverTarget is null && string.IsNullOrEmpty(_launchError))
        {
            _bootStarted = true;
            await Task.Run(() => CodexStarter.TryStart(_config.Codex, AppContext.BaseDirectory, out _launchError));
            if (string.IsNullOrEmpty(_launchError))
                _coverTarget = await CodexWindowManager.WaitForReadyAsync(
                    _config.Codex, AppContext.BaseDirectory,
                    TimeSpan.FromSeconds(_config.Codex.ReadyTimeoutSeconds), _lifetime.Token);
            if (_coverTarget is { } target) BootCover.Restore(target.Handle);
        }
        Show();
    }

    private async void OnWindowLoaded(object sender, RoutedEventArgs args)
    {
        try
        {
            string baseDir = AppContext.BaseDirectory;
            Browser.DefaultBackgroundColor = System.Drawing.Color.FromArgb(5, 6, 10);
            string webRoot = Path.Combine(baseDir, "wwwroot");
            if (_animation == "ueg") CheckUegAssets(webRoot);
            string userData = Preferences.Folder;
            Directory.CreateDirectory(userData);
            var environment = await CoreWebView2Environment.CreateAsync(null, userData);
            await Browser.EnsureCoreWebView2Async(environment);
            var web = Browser.CoreWebView2;
            await web.Profile.SetPermissionStateAsync(CoreWebView2PermissionKind.Autoplay, VirtualOrigin,
                _config.Ueg.Voice is "male" or "female" ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Default);
            web.Settings.AreDevToolsEnabled = true;  // Prototype only; disable on release.
            web.Settings.AreDefaultContextMenusEnabled = false;
            web.Settings.IsStatusBarEnabled = false;
            web.SetVirtualHostNameToFolderMapping("ueg.local", webRoot, CoreWebView2HostResourceAccessKind.DenyCors);
            if (_animation != "ueg")
            {
                web.SetVirtualHostNameToFolderMapping(AnimationHost, Path.GetDirectoryName(_animationPage)!,
                    CoreWebView2HostResourceAccessKind.Deny);
                web.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                web.WebResourceRequested += (_, e) => {
                    if (_animation == "ueg") return;
                    if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri))
                    { e.Response = web.Environment.CreateWebResourceResponse(null, 403, "Offline animation only", ""); return; }
                    if (uri.Scheme is "data" or "blob") return;
                    if (uri.Scheme != Uri.UriSchemeHttps ||
                        (uri.Host != AnimationHost && !(_handoffPending && uri.Host == "ueg.local")))
                        e.Response = web.Environment.CreateWebResourceResponse(null, 403, "Offline animation only", "");
                };
            }
            web.NavigationStarting += (_, e) => {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var url) ||
                    url.Scheme != Uri.UriSchemeHttps ||
                    !(url.Host == AnimationHost && url.AbsolutePath == "/" + Path.GetFileName(_animationPage) ||
                      url.Host == "ueg.local" && url.AbsolutePath == "/launcher.html" &&
                      (_animation == "ueg" || _handoffPending))) e.Cancel = true;
            };
            web.WebMessageReceived += OnWebMessage;
            web.NavigationCompleted += OnNavigationCompleted;
            web.Navigate(_animation == "ueg" ? VirtualOrigin + "/launcher.html" :
                "https://" + AnimationHost + "/" + Path.GetFileName(_animationPage));
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "UEG launcher initialization failed", MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
        }
    }

    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) ||
            source.Scheme != Uri.UriSchemeHttps) return;
        bool fromHpc = _animation != "ueg" && source.Host == AnimationHost &&
            source.AbsolutePath == "/" + Path.GetFileName(_animationPage);
        bool fromUeg = source.Host == "ueg.local" && source.AbsolutePath == "/launcher.html" &&
            (_animation == "ueg" || _uegDone);
        if (!fromHpc && !fromUeg) return;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            if (!doc.RootElement.TryGetProperty("type", out var kind)) return;
            var type = kind.GetString();
            if (fromHpc)
            {
                await OnHpcMessageAsync(doc.RootElement, type);
                return;
            }
            if (type == "ueg:host-ready" && !_initialized)
            {
                _initialized = true;
                var card = await ReadCardAsync();
                if (_lifetime.IsCancellationRequested) return;
                Post(new { type = "ueg:init", config = new {
                    card.Name, card.Id, card.En, card.Post, card.Level, card.Issuer, card.Valid, card.Scope, card.Bio,
                    photo = card.Photo, voice = _config.Ueg.Voice, auto = _previewOnly && _config.Ueg.Autoplay, qr = _config.Ueg.QrPayload,
                    previewOnly = _previewOnly, language = _preferences.Language
                }});
                Activate();
                Browser.Focus();
            }
            else if (type == "ueg:ready" && !_previewOnly)
            {
                await StartCodexOnReadyAsync();
            }
            else if (type == "ueg:done" && !_uegDone)
            {
                _uegDone = true;

                Activate(); // Keep the visible outcome/fallback available until real handoff.
                // The preview always stays open. A configured Codex handoff waits for a
                // genuine top-level window, then verifies foreground before closing.
                if (!_previewOnly) _ = CompleteHandoffAsync(isRetry: false);
            }
            else if ((type is "ueg:focus-request" or "ueg:retry") && _uegDone && !_previewOnly)
            {
                _ = CompleteHandoffAsync(isRetry: true);
            }
            else if (type == "ueg:close-request" && _uegDone)
            {
                Close();
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Launcher bridge error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private static void CheckUegAssets(string webRoot)
    {
        string page = Path.Combine(webRoot, "ueg.html");
        if (!File.Exists(page)) throw new FileNotFoundException(
            "Missing original UEG page. Run scripts/fetch-upstream.ps1 first.", page);
        if (!File.Exists(Path.Combine(webRoot, "assets", "ueg-land.js")))
            throw new FileNotFoundException("Missing UEG land asset. Run fetch-upstream.ps1.");
    }

    private async void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (_lifetime.IsCancellationRequested) return;
        if (_handoffPending && Browser.Source?.AbsolutePath == "/launcher.html")
        {
            _handoffPending = false;
            if (e.IsSuccess) _ = CompleteHandoffAsync(isRetry: false);
            else MessageBox.Show(this, "无法显示 Codex 交接页面", "HPC launcher", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }
        if (_animation == "ueg" || Browser.Source?.AbsolutePath != "/" + Path.GetFileName(_animationPage) || _initialized) return;
        if (!e.IsSuccess) { FallbackToUeg(); return; }
        _initialized = true;
        var card = await ReadCardAsync();
        if (_lifetime.IsCancellationRequested || _animation == "ueg") return;
        string name = _preferences.Language == "en" && !string.IsNullOrWhiteSpace(card.En) ? card.En : card.Name;
        if (string.IsNullOrWhiteSpace(name)) name = _preferences.Language == "en" ? "Liu Peiqiang" : "刘培强";
        string? avatar = card.Photo is string photo && photo.Length <= 512 * 1024 &&
            (photo.StartsWith("data:image/png;base64,", StringComparison.Ordinal) ||
             photo.StartsWith("data:image/jpeg;base64,", StringComparison.Ordinal) ||
             photo.StartsWith("data:image/webp;base64,", StringComparison.Ordinal)) ? photo : null;
        Post(new { type = "boot:init", protocolVersion = 1, sessionId = _sessionId,
            mode = _previewOnly ? "preview" : "launch", language = _preferences.Language == "en" ? "en" : "zh",
            quality = "high", card = new { displayName = name, role = card.Post, organization = (string?)null, avatar } });
        _hpcTimer.Start();
        Activate();
        Browser.Focus();
    }

    private async Task OnHpcMessageAsync(JsonElement message, string? type)
    {
        if (!_initialized || _hpcTerminal ||
            !message.TryGetProperty("protocolVersion", out var version) || version.ValueKind != JsonValueKind.Number ||
            !version.TryGetInt32(out int number) || number != 1 ||
            !message.TryGetProperty("sessionId", out var session) || session.ValueKind != JsonValueKind.String ||
            session.GetString() != _sessionId) return;
        if (type == "boot:ready" && !_hpcReady)
        {
            _hpcReady = true;
            _hpcTimer.Stop();
            if (!_previewOnly) await StartCodexOnReadyAsync();
        }
        else if (type == "boot:done" && !_previewOnly &&
            message.TryGetProperty("reason", out var reason) && reason.ValueKind == JsonValueKind.String &&
            reason.GetString() is "complete" or "skip")
        {
            _hpcTerminal = true;
            _hpcTimer.Stop();
            _uegDone = true;
            _handoffPending = true;
            Browser.CoreWebView2.Navigate(VirtualOrigin + "/launcher.html?handoff=1&animation=hpc&lang=" + _preferences.Language);
        }
        else if (type == "boot:error") FallbackToUeg();
    }

    private async Task StartCodexOnReadyAsync()
    {
        if (!_bootStarted)
        {
            _bootStarted = true;
            if (string.IsNullOrEmpty(_launchError) &&
                (_coverTarget is null || !BootCover.Owns(_coverTarget.Value.Handle, _coverTarget.Value.ProcessId)))
                await Task.Run(() => CodexStarter.TryStart(_config.Codex, AppContext.BaseDirectory, out _launchError));
        }
        if (Topmost && string.IsNullOrEmpty(_launchError)) _coverTimer.Start();
    }

    private void FallbackToUeg()
    {
        if (_animation == "ueg" || _hpcTerminal) return;
        _hpcTimer.Stop();
        _hpcTerminal = true;
        _animation = "ueg";
        Title = "UEG · Codex";
        _initialized = false;
        try
        {
            CheckUegAssets(Path.Combine(AppContext.BaseDirectory, "wwwroot"));
            Browser.CoreWebView2.Navigate(VirtualOrigin + "/launcher.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "UEG fallback failed", MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
        }
    }

    private void ShowHandoffStatus(string state, string message)
    {
        if (_preferences.Language == "en") message = state switch
        {
            "waiting" => "Waiting for the verified Codex window…",
            "focus-denied" => "Codex is ready, but Windows blocked focus. Retry or select Codex on the taskbar.",
            _ => "Could not confirm the Codex window. Open Codex and retry, or close the launcher."
        };
        if (state is "failed" or "focus-denied") ReleaseCover();
        if (Browser.CoreWebView2 is null || _lifetime.IsCancellationRequested) return;
        Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "ueg:handoff-status", state, message
        }));
    }

    private async Task CompleteHandoffAsync(bool isRetry)
    {
        if (_handoffRunning || _lifetime.IsCancellationRequested) return;
        _handoffRunning = true;
        try
        {
            if (!CodexWindowManager.TryValidate(_config.Codex, AppContext.BaseDirectory, out var error))
            {
                ShowHandoffStatus("failed", "尚未配置可验证的 Codex 窗口身份：" + error);
                return;
            }
            if (!_bootStarted) await StartCodexOnReadyAsync();
            ShowHandoffStatus("waiting", "正在等待真实 Codex 主窗口，未确认前不会关闭启动器…");
            var timeout = isRetry ? 12 : (string.IsNullOrEmpty(_launchError) ? _config.Codex.ReadyTimeoutSeconds : 10);
            var candidate = await CodexWindowManager.WaitForReadyAsync(
                _config.Codex, AppContext.BaseDirectory, TimeSpan.FromSeconds(timeout), _lifetime.Token);
            if (candidate is null)
            {
                string detail = string.IsNullOrEmpty(_launchError) ? "" : (" 启动请求错误：" + _launchError);
                ShowHandoffStatus("failed", "没有找到符合进程身份的 Codex 主窗口；可手动打开 Codex 后重试。" + detail);
                return;
            }
            ShowHandoffStatus("waiting", "已确认 Codex 主窗口，正在尝试移交焦点…");
            if (await CodexWindowManager.TryForegroundAsync(
                _config.Codex, AppContext.BaseDirectory, candidate.Value, _lifetime.Token))
            {
                // True window identity and foreground verified; only now close the shell.
                Close();
            }
            else
            {
                ShowHandoffStatus("focus-denied", "Codex 窗口已找到，但 Windows 未允许切换前台。可点击重试，或在任务栏手动选择 Codex。");
            }
        }
        catch (OperationCanceledException) { /* Window closed by the user. */ }
        catch (Exception ex)
        {
            ShowHandoffStatus("failed", "交接异常（未关闭启动器）：" + ex.Message);
        }
        finally { _handoffRunning = false; }
    }

    private async void CoverDesktop()
    {
        if (_coverTarget is { } previous && !BootCover.Owns(previous.Handle, previous.ProcessId)) _coverTarget = null;
        if (_coverTarget is null && _bootStarted && !_finding)
        {
            _finding = true;
            try
            {
                _coverTarget = await Task.Run(() => CodexWindowManager.Find(_config.Codex, AppContext.BaseDirectory));
                await Task.Delay(400, _lifetime.Token);
            }
            catch (OperationCanceledException) { return; }
            finally { _finding = false; }
        }
        if (!_lifetime.IsCancellationRequested)
            BootCover.Place(this, _coverTarget?.Handle ?? 0, _preferences.Display == "fullscreen");
    }

    private void ReleaseCover()
    {
        _coverTimer.Stop();
        Topmost = false;
        ShowInTaskbar = true; // Keep a failed handoff reachable after the user switches away.
    }

    private void Post(object message)
    {
        if (!_lifetime.IsCancellationRequested)
            Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, AccountCards.Json));
    }

    private async Task<OperatorConfig> ReadCardAsync()
    {
        try
        {
            var email = await AccountCards.ReadEmailAsync(_lifetime.Token);
            return AccountCards.LoadForLaunch(CardFolder, email);
        }
        catch (Exception)
        {
            try { AccountCards.LoadForLaunch(CardFolder, null); } catch { }
            return new();
        }
    }
}
