# Windows 10/11; .NET 8 SDK required to compile, WebView2 Runtime to run.
param([string] $Runtime = 'win-x64')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$project = Join-Path $root 'src\UEGCodexLauncher\UEGCodexLauncher.csproj'
$errors = @()
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
  $errors += '.NET command not found. Install .NET 8 SDK (not only Desktop Runtime): winget install --id Microsoft.DotNet.SDK.8 -e'
} else {
  $sdks = @(& dotnet --list-sdks)
  if ($LASTEXITCODE -ne 0 -or $sdks.Count -eq 0) {
    $errors += 'dotnet exists, but NO SDK is installed. Install .NET 8 SDK: winget install --id Microsoft.DotNet.SDK.8 -e'
  } elseif (-not @($sdks | Where-Object { $_ -match '^8\.' }).Count) {
    Write-Warning 'No .NET 8 SDK found. Other SDK versions may compile net8.0-windows if targeting packs are installed; .NET 8 SDK is recommended.'
  }
}
try { & (Join-Path $PSScriptRoot 'check-upstream.ps1') } catch { $errors += $_.Exception.Message }
if ($errors.Count -gt 0) { throw ('Build prerequisites not satisfied:' + [Environment]::NewLine + ($errors -join [Environment]::NewLine)) }
$target = Join-Path $root ('dist\' + $Runtime)
& node (Join-Path $PSScriptRoot 'build-english.cjs')
if ($LASTEXITCODE -ne 0) { throw 'English page generation failed' }
Write-Host ('Publishing: ' + $project + ' for ' + $Runtime)
& dotnet publish $project -c Release -r $Runtime --self-contained false -o $target
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed; do not claim a built EXE.' }
if (-not (Test-Path (Join-Path $target 'UEGCodexLauncher.exe'))) { throw 'dotnet publish returned but EXE not found' }
Write-Host "Published: $target"
Write-Host 'For a local desktop entry, run scripts/install-shortcut.ps1 after publishing.'
