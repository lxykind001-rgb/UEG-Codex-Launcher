param([string]$EndpointFile = '')
$ErrorActionPreference = 'Stop'
$exe = (Resolve-Path "$PSScriptRoot/../dist/win-x64/UEGCodexLauncher.exe").Path
if (!$EndpointFile) { $EndpointFile = Join-Path $env:LOCALAPPDATA 'UEGCodexLauncher/settings-endpoint.json' }
if (Test-Path -LiteralPath $EndpointFile) {
  try {
    $old = Get-Content -Raw -LiteralPath $EndpointFile | ConvertFrom-Json
    $uri = [Uri]$old.url
    $p = Get-Process -Id $old.pid -ErrorAction Stop
    if ($p.Path -eq $exe -and $uri.Host -eq '127.0.0.1' -and $uri.Scheme -eq 'http') {
      $headers = @{ Authorization = ('Bearer ' + $uri.Fragment.Substring(1)) }
      $null = Invoke-RestMethod -Uri ($uri.GetLeftPart('Authority') + '/api') -Headers $headers -TimeoutSec 8
      $old.url
      exit 0
    }
  } catch { }
}
$p = Start-Process -FilePath $exe -ArgumentList @('--settings-server', ('"' + $EndpointFile + '"')) -PassThru -WindowStyle Hidden
for ($i=0; $i -lt 80; $i++) {
  if ($p.HasExited) { throw 'UEG settings server could not start' }
  if (Test-Path -LiteralPath $EndpointFile) {
    try {
      $entry = Get-Content -Raw -LiteralPath $EndpointFile | ConvertFrom-Json
      if ($entry.pid -eq $p.Id) { $entry.url; exit 0 }
    } catch { }
  }
  Start-Sleep -Milliseconds 100
}
throw 'UEG settings server did not become ready'
