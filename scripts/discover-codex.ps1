# READ ONLY. This never launches Codex or changes system settings.
# Obtain candidates, then verify the actual main process in Task Manager.
$ErrorActionPreference = 'Continue'
Write-Host '=== Candidate Start menu entries ==='
try {
    $entries = @(Get-StartApps | Where-Object { $_.Name -match 'Codex' -or $_.AppID -match 'Codex' })
    $entries | Select-Object Name, AppID | Format-Table -AutoSize
} catch {
    Write-Warning ('Get-StartApps could not be read: ' + $_.Exception.Message)
}
Write-Host '=== Possible Codex processes, main window title / handle / EXE path ==='
$matches = Get-Process | Where-Object {
    $_.ProcessName -match 'Codex' -or $_.MainWindowTitle -match 'Codex' -or
        ($_.MainWindowHandle -ne 0 -and $entries.Name -contains $_.ProcessName)
}
$matches | ForEach-Object {
    $p = $_
    $path = try { $p.MainModule.FileName } catch { '<path access denied or packaged>' }
    [PSCustomObject]@{
        ProcessName = $p.ProcessName
        PID = $p.Id
        MainWindowHandle = $p.MainWindowHandle
        MainWindowTitle = $p.MainWindowTitle
        ExePath = $path
    }
} | Format-List
Write-Host 'Read-only discovery complete. For aumid/shortcut mode, set codex.windowProcessNames to the verified ProcessName (without .exe).'
