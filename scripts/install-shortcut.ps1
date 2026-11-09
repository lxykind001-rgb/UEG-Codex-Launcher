# Run after build-win.ps1. Only create/update the separately named UEG shortcut.
$ErrorActionPreference = 'Stop'
$dist = (Resolve-Path "$PSScriptRoot/../dist/win-x64").Path
$local = Join-Path (Split-Path $dist) 'win-x64-local'
$exe = Join-Path $local 'UEGCodexLauncher.exe'
$link = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Codex - UEG.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
if ((Test-Path -LiteralPath $link) -and $shortcut.TargetPath -ne $exe) {
  throw "Shortcut name already in use: $link"
}
$id = 'OpenAI.Codex_2p2nqsd0c76g0!App'
$pkg = Get-AppxPackage OpenAI.Codex
if (!$pkg -or !(Get-StartApps | Where-Object AppID -eq $id)) { throw 'Official desktop registration not found' }
$manifest = Get-AppxPackageManifest $pkg
$entry = @($manifest.Package.Applications.Application) | Where-Object Id -eq 'App' | Select-Object -First 1
$official = Join-Path $pkg.InstallLocation $entry.Executable
if (!(Test-Path -LiteralPath $official -PathType Leaf)) { throw 'Official application executable missing' }
New-Item -ItemType Directory -Force $local | Out-Null
Get-ChildItem -LiteralPath $dist | Copy-Item -Destination $local -Recurse -Force
$cfgPath = Join-Path $local 'launcher.config.json'
$config = Get-Content -Raw -Encoding UTF8 $cfgPath | ConvertFrom-Json
$config.codex.mode = 'aumid'
$config.codex.target = $id
$config.codex.windowProcessNames = @([IO.Path]::GetFileNameWithoutExtension($official))
$config | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath $cfgPath
$iconPath = Join-Path $local 'codex-shortcut.ico'
Copy-Item -LiteralPath (Join-Path $pkg.InstallLocation 'app/resources/icon-chatgpt.ico') -Destination $iconPath -Force
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $local
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'UEG startup animation for Codex'
$shortcut.Save()
if ($shell.CreateShortcut($link).TargetPath -ne $exe) { throw 'Shortcut readback failed' }
"Created $link -> $exe ($($config.codex.windowProcessNames))"
