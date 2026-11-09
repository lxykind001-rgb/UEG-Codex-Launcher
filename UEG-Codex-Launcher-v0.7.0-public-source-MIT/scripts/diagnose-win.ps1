# Read-only environment check for Codex. Doesn't change Windows or start apps.
$ErrorActionPreference = 'Continue'
Write-Host '=== UEG Codex Launcher / read-only Windows diagnostics ==='
Write-Host ('OS: ' + [Environment]::OSVersion.VersionString)
foreach ($program in @('git','dotnet','node')) {
  $cmd = Get-Command $program -ErrorAction SilentlyContinue
  if ($cmd) { Write-Host ("$program : " + $cmd.Source) } else { Write-Host "$program : missing" }
}
Write-Host '=== Codex entries found in StartApps ==='
try {
  Get-StartApps | Where-Object { $_.Name -match 'Codex' } | Format-Table Name, AppID -AutoSize
} catch { Write-Host ('Get-StartApps not available: ' + $_.Exception.Message) }
Write-Host '=== Existing launcher material ==='
$web = Join-Path $PSScriptRoot '..\src\UEGCodexLauncher\wwwroot'
@('ueg.html','assets\ueg-land.js','assets\ueg-seal-white.png','assets\ueg-lockup-white.png') | ForEach-Object {
  Write-Host (($_ + ' => ') + (Test-Path (Join-Path $web $_)))
}
Write-Host '=== Done. No changes made. ==='
