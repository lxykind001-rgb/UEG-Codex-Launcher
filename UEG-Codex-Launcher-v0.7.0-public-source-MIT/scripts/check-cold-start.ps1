# B-01: run in a separate Windows PowerShell after exiting the official client.
$ErrorActionPreference = 'Stop'
$logFolder = Join-Path $PSScriptRoot '../docs/v0.5-evidence'
[void](New-Item -ItemType Directory -Path $logFolder -Force)
$logPath = Join-Path $logFolder ('cold-start-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Start-Transcript -Path $logPath | Out-Null
try {
$release = (Resolve-Path "$PSScriptRoot/../dist/win-x64-local").Path
$config = Get-Content -Raw -Encoding UTF8 (Join-Path $release 'launcher.config.json') | ConvertFrom-Json
$target = $config.codex
if ($target.mode -ne 'aumid' -or $target.target -notlike '*!*' -or !$target.windowProcessNames) {
    throw 'Use the verified local AUMID release for this test.'
}
if (!(Get-StartApps | Where-Object AppID -eq $target.target)) { throw 'Configured AppID is not registered.' }
$family = $target.target.Split('!')[0]
$package = @(Get-AppxPackage | Where-Object PackageFamilyName -eq $family)
if ($package.Count -ne 1) { throw 'Cannot identify the installed package.' }
$packageRoot = $package[0].InstallLocation.TrimEnd('\') + '\'
function Get-ClientProcesses {
    Get-Process -Name $target.windowProcessNames -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($packageRoot, [StringComparison]::OrdinalIgnoreCase) }
}
if (Get-ClientProcesses) { throw 'B-01 not run: the verified desktop package is already running. Exit it first.' }
Add-Type -Path "$PSScriptRoot/find-visible-window.cs"
Add-Type -Namespace UegCold -Name Window -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct Rect { public int Left, Top, Right, Bottom; }
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(System.IntPtr h, out Rect r);
[System.Runtime.InteropServices.DllImport("dwmapi.dll")]
public static extern int DwmGetWindowAttribute(System.IntPtr h, int attribute, out Rect r, int size);
'@
$profile = if ($env:WEBVIEW2_USER_DATA_FOLDER) { $env:WEBVIEW2_USER_DATA_FOLDER } else { Join-Path $env:LOCALAPPDATA 'UEGCodexLauncher/WebView2' }
$prefs = Join-Path $profile 'preferences.json'
$display = if (Test-Path -LiteralPath $prefs) { (Get-Content -Raw $prefs | ConvertFrom-Json).display } else { 'app' }
Write-Output ('Launcher DLL SHA256: ' + (Get-FileHash (Join-Path $release 'UEGCodexLauncher.dll')).Hash)
Write-Output 'Click the UEG access button and allow the animation to finish. Leave the launcher to close itself.'
$watch = [Diagnostics.Stopwatch]::StartNew()
$launcher = Start-Process -FilePath (Join-Path $release 'UEGCodexLauncher.exe') -WorkingDirectory $release -PassThru
$firstCover = $null
while (!$launcher.HasExited -and $watch.Elapsed.TotalSeconds -lt 180) {
    $launcher.Refresh()
    if (!$firstCover) { $launcherWindow = [UegVisibleWindow]::Find($launcher.Id) }
    if (!$firstCover -and $launcherWindow -ne [IntPtr]::Zero) {
        $rect = New-Object UegCold.Window+Rect
        [void][UegCold.Window]::GetWindowRect($launcherWindow, [ref]$rect)
        $targetWindow = Get-ClientProcesses | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
        $targetRect = $null
        if ($targetWindow) {
            $targetRect = New-Object UegCold.Window+Rect
            [void][UegCold.Window]::DwmGetWindowAttribute($targetWindow.MainWindowHandle, 9, [ref]$targetRect, 16)
        }
        $firstCover = @{ms=$watch.ElapsedMilliseconds; display=$display; bounds=$rect; targetBounds=$targetRect}
        Write-Output ('B-01 FIRST-COVER: ' + ($firstCover | ConvertTo-Json -Compress -Depth 4))
    }
    Start-Sleep -Milliseconds 50
}
if (!$launcher.HasExited) { throw 'B-01 inconclusive: the launcher is still open after 180 seconds.' }
$front = [UegCold.Window]::GetForegroundWindow()
$client = Get-ClientProcesses | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowHandle -eq $front }
if ($launcher.ExitCode -ne 0 -or !$client) { throw 'B-01 failed: launcher exit and the foreground package window were not both confirmed.' }
if (!$firstCover) { throw 'B-01 inconclusive: the initial cover was not sampled.' }
if ($display -ne 'fullscreen' -and (!$firstCover.targetBounds -or
    ($firstCover.bounds | ConvertTo-Json -Compress) -ne ($firstCover.targetBounds | ConvertTo-Json -Compress))) {
    throw 'B-01 failed: the first observed app cover did not match the official window.'
}
Write-Output ("B-01 PASS  AppID={0}  PID={1}  HWND={2}" -f $target.target, $client.Id, $front)
} catch {
    Write-Output ("B-01 NOT PASSED: " + $_.Exception.Message)
    throw
} finally {
    Stop-Transcript | Out-Null
    Write-Output ("Acceptance log: " + $logPath)
}
