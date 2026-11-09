# Run with PowerShell 7 after scripts/build-win.ps1. This test never activates an application.
$ErrorActionPreference = 'Stop'
$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path "$PSScriptRoot/../dist/win-x64/UEGCodexLauncher.dll"))
$config = [Activator]::CreateInstance($assembly.GetType('UEGCodexLauncher.CodexConfig', $true))
$config.Mode = 'aumid'
$config.WindowProcessNames = @('ChatGPT')
$validate = $assembly.GetType('UEGCodexLauncher.CodexWindowManager', $true).GetMethod('TryValidate', [Reflection.BindingFlags]'Static,NonPublic')
foreach ($invalidId in 'UEG.PhaseTwo.Nonexistent', 'UEG_PhaseTwo!Missing') {
    $config.Target = $invalidId
    $arguments = @($config, $PSScriptRoot, '')
    if ($validate.Invoke($null, $arguments) -or $arguments[2] -notmatch 'AUMID not found') {
        throw "Unregistered AppID was not rejected at validation: $invalidId"
    }
}
Write-Output 'PASS: both unregistered AppIDs were rejected before window reuse or activation.'
