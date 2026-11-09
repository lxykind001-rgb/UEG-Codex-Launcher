# PowerShell 5.1+  |  Download original UEG preview without modifying its HTML/CSS/JS.
param(
  [string] $SourceDir = "",
  [string] $GitRef = "main"
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dest = Join-Path $root 'src\UEGCodexLauncher\wwwroot'
$cache = Join-Path $root '.cache\dsh-550c-boot'
if ([string]::IsNullOrWhiteSpace($SourceDir)) {
  if (-not (Test-Path (Join-Path $cache 'preview\ueg.html'))) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git not found. Install Git or pass -SourceDir to an extracted repository.' }
    New-Item -ItemType Directory -Path (Split-Path $cache) -Force | Out-Null
    & git clone --depth 1 --branch $GitRef https://github.com/yannicksong0106/dsh-550c-boot.git $cache
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
  }
  $SourceDir = $cache
}
$SourceDir = (Resolve-Path $SourceDir).Path
$preview = Join-Path $SourceDir 'preview'
foreach ($part in @('ueg.html', 'assets\ueg-land.js', 'assets\ueg-seal-white.png', 'assets\ueg-lockup-white.png')) {
  if (-not (Test-Path (Join-Path $preview $part))) { throw "Required UEG file missing in upstream: $part" }
}
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item -Path (Join-Path $preview 'ueg.html') -Destination (Join-Path $dest 'ueg.html') -Force
foreach ($folder in @('assets', 'voice')) {
  $from = Join-Path $preview $folder
  $to = Join-Path $dest $folder
  if (Test-Path $from) {
    if (Test-Path $to) { Remove-Item $to -Recurse -Force }
    Copy-Item -Path $from -Destination $to -Recurse -Force
  }
}
$legal = Join-Path $root 'upstream-attribution'
New-Item -ItemType Directory -Path $legal -Force | Out-Null
foreach ($f in @('LICENSE', 'CREDITS.md')) {
  if (Test-Path (Join-Path $SourceDir $f)) { Copy-Item (Join-Path $SourceDir $f) (Join-Path $legal $f) -Force }
}
if (Test-Path (Join-Path $SourceDir '.git')) {
  $commit = (& git -C $SourceDir rev-parse HEAD)
  if ($LASTEXITCODE -eq 0) { Set-Content (Join-Path $legal 'UPSTREAM_COMMIT.txt') -Value $commit -Encoding ascii }
}
$voice = Get-ChildItem (Join-Path $dest 'voice') -Filter 'voice-*-*.wav' -ErrorAction SilentlyContinue
Write-Host 'UEG upstream preview copied intact.'
Write-Host "Assets at: $dest"
Write-Host ('Voice segments found: ' + @($voice).Count)
if (@($voice).Count -eq 0) { Write-Warning 'No WAV segments. Set ueg.voice to off until voice assets are added.' }
Write-Host 'Next: .\scripts\build-win.ps1'
