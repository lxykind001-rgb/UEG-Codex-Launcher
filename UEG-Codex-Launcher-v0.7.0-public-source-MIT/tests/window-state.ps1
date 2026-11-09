param([int]$LauncherPid=0,[ValidateSet('Inspect','Minimize','Restore')][string]$Action='Inspect')
$ErrorActionPreference='Stop'
Add-Type -Path "$PSScriptRoot/../scripts/find-visible-window.cs"
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class UegWindowProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int command);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
 [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")] public static extern int Bounds(IntPtr h, int a, out Rect r, int size);
}
'@
$target=@(Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0 -and $_.Path -like '*\OpenAI.Codex_*'})
if($target.Count -ne 1){throw 'Expected one official Codex main window'}
if($Action -ne 'Inspect'){
 $command=if($Action -eq 'Minimize'){6}else{9}
 [void][UegWindowProbe]::ShowWindowAsync($target[0].MainWindowHandle,$command)
 Start-Sleep -Milliseconds 400
}
$rect=New-Object UegWindowProbe+Rect
[void][UegWindowProbe]::Bounds($target[0].MainWindowHandle,9,[ref]$rect,16)
$data=@{target=$target[0].MainWindowHandle.ToInt64();targetBounds=$rect;foreground=[UegWindowProbe]::GetForegroundWindow().ToInt64()}
$data.minimized=[UegWindowProbe]::IsIconic($target[0].MainWindowHandle)
$data.dpi=[UegWindowProbe]::GetDpiForWindow($target[0].MainWindowHandle)
if($LauncherPid){
 $window=[UegVisibleWindow]::Find($LauncherPid)
 if($window -eq [IntPtr]::Zero){throw 'Launcher window is not ready'}
 [void][UegWindowProbe]::GetWindowRect($window,[ref]$rect)
 $transitions=0;$corners=0
 $transitionResult=[UegWindowProbe]::DwmGetWindowAttribute($window,3,[ref]$transitions,4)
 $cornerResult=[UegWindowProbe]::DwmGetWindowAttribute($window,33,[ref]$corners,4)
 $data.launcher=$window.ToInt64();$data.bounds=$rect;$data.style=[UegWindowProbe]::GetWindowLong($window,-16)
 $data.exStyle=[UegWindowProbe]::GetWindowLong($window,-20)
 $data.transitionsDisabled=$transitions;$data.transitionResult=$transitionResult;$data.corners=$corners;$data.cornerResult=$cornerResult
}
$data | ConvertTo-Json -Compress
