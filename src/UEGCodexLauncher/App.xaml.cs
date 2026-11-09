using System.Windows;
namespace UEGCodexLauncher;
public partial class App : Application
{
    private async void OnStartup(object sender, StartupEventArgs e)
    {
        try
        {
            if (e.Args is ["--settings-server", var endpoint])
            {
                ShutdownMode = ShutdownMode.OnExplicitShutdown;
                await SettingsServer.RunAsync(endpoint);
                Shutdown();
            }
            else await new MainWindow().ShowStartupAsync();
        }
        catch (Exception ex)
        {
            if (e.Args.Contains("--settings-server")) Shutdown(1);
            else { MessageBox.Show(ex.Message, "UEG launcher"); Shutdown(1); }
        }
    }
}
