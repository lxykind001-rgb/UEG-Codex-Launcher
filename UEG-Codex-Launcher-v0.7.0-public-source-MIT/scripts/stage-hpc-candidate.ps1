param(
  [Parameter(Mandatory=$true)][string]$Package,
  [string]$Release = 'dist/win-x64-hpc-test'
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releasePath=[IO.Path]::GetFullPath((Join-Path $root $Release))
$distPath=[IO.Path]::GetFullPath((Join-Path $root 'dist'))+[IO.Path]::DirectorySeparatorChar
if(!$releasePath.StartsWith($distPath,[StringComparison]::OrdinalIgnoreCase)) { throw 'Release must be inside the project dist directory' }
$zip=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Package).Path)
try {
  $manifest=$zip.GetEntry('SHA256SUMS.txt') ?? (throw 'Missing SHA256SUMS.txt')
  $reader=[IO.StreamReader]::new($manifest.Open())
  try { $lines=$reader.ReadToEnd() -split "`r?`n" } finally { $reader.Dispose() }
  foreach($line in $lines | Where-Object { $_ }) {
    if($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw "Invalid SHA256SUMS line: $line" }
    $expected=$Matches[1];$name=$Matches[2]
    $entry=$zip.GetEntry($name) ?? (throw "Missing archive entry: $name")
    $stream=$entry.Open()
    try { $actual=([BitConverter]::ToString([Security.Cryptography.SHA256]::HashData($stream))).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose() }
    if($actual -ne $expected) { throw "SHA-256 mismatch: $name" }
  }
  $embedded=$zip.GetEntry('boot.html') ?? $zip.GetEntry('HPC_V0.9.7_Embedded_Boot.html') ?? (throw 'Missing embedded HTML')
  if($zip.GetEntry('pack.json')) {
    $packReader=[IO.StreamReader]::new($zip.GetEntry('pack.json').Open())
    try { $pack=$packReader.ReadToEnd() | ConvertFrom-Json } finally { $packReader.Dispose() }
    if($pack.id -ne 'hpc' -or $pack.entry -ne 'boot.html' -or $pack.bootProtocol -ne 1) { throw 'Unexpected HPC pack metadata' }
  }
  if(!(Test-Path -LiteralPath (Join-Path $releasePath 'UEGCodexLauncher.exe'))) { throw 'Create an isolated launcher release before staging HPC' }
  $target=Join-Path $releasePath 'hpc/boot.html'
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  $source=$embedded.Open();$output=[IO.File]::Create($target)
  try { $source.CopyTo($output) } finally { $source.Dispose();$output.Dispose() }
  Write-Output "Staged for local integration testing: $target"
  Write-Output 'HPC candidate is not licensed for public redistribution; do not include this file in the public source ZIP.'
} finally { $zip.Dispose() }
