# Fails closed: never turn missing original HTML/assets into a passing test.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$web = Join-Path $root 'src\UEGCodexLauncher\wwwroot'
$legal = Join-Path $root 'upstream-attribution'
$required = @(
  'ueg.html',
  'assets\ueg-land.js',
  'assets\ueg-seal-white.png',
  'assets\ueg-lockup-white.png'
)
$missing = @($required | Where-Object { -not (Test-Path -PathType Leaf (Join-Path $web $_)) })
$missing += @(@('LICENSE','CREDITS.md') | Where-Object { -not (Test-Path -PathType Leaf (Join-Path $legal $_)) } | ForEach-Object { 'upstream-attribution\' + $_ })
if ($missing.Count -gt 0) {
  throw ('Missing upstream files: ' + ($missing -join ', ') + [Environment]::NewLine +
    'Run .\scripts\fetch-upstream.ps1 (requires Git / network), or supply -SourceDir with an extracted official repository.')
}
foreach ($file in $required) {
  $size = (Get-Item (Join-Path $web $file)).Length
  if ($size -lt 100) { throw ('Upstream file appears truncated: ' + $file + ' (' + $size + ' bytes)') }
}
$html = Get-Content (Join-Path $web 'ueg.html') -Raw -Encoding UTF8
if ($html.Length -lt 20000 -or $html -notmatch 'ueg:done' -or $html -notmatch 'ueg:need-photo') {
  throw 'UEG page truncated or upstream handshake changed: inspect preview/ueg.html before testing.'
}
$land = Get-Content (Join-Path $web 'assets\ueg-land.js') -Raw -Encoding UTF8
if ($land -notmatch 'UEG_LAND') { throw 'UEG land data missing its expected UEG_LAND symbol.' }
Write-Host 'PASS: required UEG animation assets, protocol tokens and license/credits are present.'
$voice = @(Get-ChildItem (Join-Path $web 'voice') -Filter 'voice-*-*.wav' -ErrorAction SilentlyContinue)
if ($voice.Count -eq 0) {
  Write-Warning 'No optional WAV voice segments: UEG visuals can be tested with ueg.voice=off. This specific preview/ueg.html uses Audio(WAV), not a TTS fallback.'
} else {
  Write-Host ('Optional voice WAV segments found: ' + $voice.Count)
}
