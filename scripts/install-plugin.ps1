$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/..").Path
if (!(Test-Path -LiteralPath "$root/dist/win-x64/UEGCodexLauncher.exe")) { throw 'Build the launcher first' }
@{ projectRoot = $root } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath "$root/marketplace/plugins/ueg-startup/installation.json"
$mcpConfig = @{ mcpServers = @{ ueg_settings = @{ command = (Get-Command node -ErrorAction Stop).Source; args = @("$root/scripts/plugin-settings.cjs"); startup_timeout_sec = 15; tool_timeout_sec = 60 } } } | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText("$root/marketplace/plugins/ueg-startup/.mcp.json", $mcpConfig, (New-Object Text.UTF8Encoding($false)))
& codex plugin marketplace add "$root/marketplace" --json
if ($LASTEXITCODE -ne 0) { throw 'Local marketplace registration failed' }
& codex plugin add 'ueg-startup@ueg-local' --json
if ($LASTEXITCODE -ne 0) { throw 'UEG plugin installation failed' }
