# Run with Windows PowerShell 5.1. A delayed test app exercises the real cold overlay path.
param([string]$Release = "$PSScriptRoot/../dist/win-x64-local")
$ErrorActionPreference='Stop'
Add-Type -Path "$PSScriptRoot/../scripts/find-visible-window.cs"
$case=Join-Path "$PSScriptRoot/../.cache" ('initial-cover-'+[Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $case -Force)
$case=(Resolve-Path $case).Path
$copy=Join-Path $case 'release'
Copy-Item -LiteralPath $Release -Destination $copy -Recurse
$targetExe=Join-Path $case 'DelayedTarget.exe'
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $targetExe -OutputType WindowsApplication -TypeDefinition @'
using System;
using System.Threading;
using System.Windows.Forms;
public class DelayedTarget {
 [STAThread] public static void Main() {
  Thread.Sleep(1800);
  using(var form = new Form()) {
   form.Text="UEG delayed acceptance target";
   form.StartPosition=FormStartPosition.Manual;
   form.FormBorderStyle=FormBorderStyle.None;
   form.SetBounds(580,210,1000,700);
   Application.Run(form);
  }
 }
}
'@
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class InitialCoverProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
}
'@
$configPath=Join-Path $copy 'launcher.config.json'
$config=Get-Content -Raw $configPath | ConvertFrom-Json
$config.codex.mode='exe';$config.codex.target=$targetExe
$config.codex.windowProcessNames=@('DelayedTarget');$config.codex.readyTimeoutSeconds=8
$config | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $configPath
$profile=Join-Path $case 'profile';[void](New-Item -ItemType Directory -Path $profile)
'{"display":"app","language":"en"}' | Set-Content -Encoding UTF8 (Join-Path $profile 'preferences.json')
$previousProfile=$env:WEBVIEW2_USER_DATA_FOLDER
$env:WEBVIEW2_USER_DATA_FOLDER=$profile
$launcher=$null;$samples=@();$matchedSamples=0;$watch=[Diagnostics.Stopwatch]::StartNew()
try {
 $launcher=Start-Process (Join-Path $copy 'UEGCodexLauncher.exe') -PassThru
 while($watch.Elapsed.TotalSeconds -lt 25){
  $launcher.Refresh();$handle=[UegVisibleWindow]::Find($launcher.Id)
  $target=Get-Process DelayedTarget -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $targetExe -and $_.MainWindowHandle -ne 0} | Select-Object -First 1
  if($handle -ne 0 -and [InitialCoverProbe]::IsWindowVisible($handle)){
   $rect=New-Object InitialCoverProbe+Rect
   [void][InitialCoverProbe]::GetWindowRect($handle,[ref]$rect)
   $targetRect=$null
   if($target){$targetRect=New-Object InitialCoverProbe+Rect;[void][InitialCoverProbe]::GetWindowRect($target.MainWindowHandle,[ref]$targetRect)}
   $samples+=@{ms=$watch.ElapsedMilliseconds;bounds=$rect;targetBounds=$targetRect}
   if($target -and ($rect | ConvertTo-Json -Compress) -eq ($targetRect | ConvertTo-Json -Compress)){$matchedSamples++}else{$matchedSamples=0}
   if($matchedSamples -ge 10){break}
  }
  Start-Sleep -Milliseconds 25
 }
 $evidence=Join-Path $case 'first-visible.json'
 ConvertTo-Json -InputObject $samples -Depth 5 | Set-Content -Encoding UTF8 $evidence
 Write-Output "Evidence: $evidence"
 if(!$samples.Count){throw 'Launcher never became visible'}
 if($matchedSamples -lt 10){throw 'FAIL: overlay never settled on the target'}
 foreach($sample in $samples){
  if(!$sample.targetBounds){throw 'FAIL: launcher was visible before the target existed'}
  if(($sample.bounds | ConvertTo-Json -Compress) -ne ($sample.targetBounds | ConvertTo-Json -Compress)){
   throw 'FAIL: visible launcher bounds did not match the target'
  }
 }
 Write-Output 'PASS: every sampled visible overlay frame covered the delayed target from its first appearance'
} finally {
 $env:WEBVIEW2_USER_DATA_FOLDER=$previousProfile
 if($launcher -and !$launcher.HasExited){Stop-Process -Id $launcher.Id}
 Get-Process DelayedTarget -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $targetExe} | Stop-Process
}
