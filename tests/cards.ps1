# Run in PowerShell 7 after build-win.ps1. Uses synthetic accounts and a fresh temporary directory.
$ErrorActionPreference='Stop'
$assembly=[Reflection.Assembly]::LoadFrom((Resolve-Path "$PSScriptRoot/../dist/win-x64/UEGCodexLauncher.dll"))
$type=$assembly.GetType('UEGCodexLauncher.AccountCards',$true)
$flags=[Reflection.BindingFlags]'Static,NonPublic'
$save=$type.GetMethod('Save',$flags)
$load=$type.GetMethod('Load',$flags)
$list=$type.GetMethod('ListProfiles',$flags)
$queue=$type.GetMethod('Queue',$flags)
$launch=$type.GetMethod('LoadForLaunch',$flags)
$reset=$type.GetMethod('Reset',$flags)
$dir=[IO.Path]::Combine([IO.Path]::GetTempPath(), 'ueg-card-test-'+[Guid]::NewGuid().ToString('N'))
try {
    $card=[Activator]::CreateInstance($assembly.GetType('UEGCodexLauncher.OperatorConfig',$true))
    $card.Name='Alice'; $card.Id='UEG-A'
    $null=$save.Invoke($null,@($dir,'a@example.test','A@example.test',$card))
    $card.Name='Bob'; $card.Id='UEG-B'
    $null=$save.Invoke($null,@($dir,'b@example.test','b@example.test',$card))
    if ($load.Invoke($null,@($dir,'A@example.test')).Id -ne 'UEG-A') {throw 'Account A mismatch'}
    if ($load.Invoke($null,@($dir,'b@example.test')).Name -ne 'Bob') {throw 'Account B mismatch'}
    if ($load.Invoke($null,@($dir,$null)).Name -ne '') {throw 'Guest received a saved card'}
    foreach ($changed in @('b@example.test','')) {
        try { $null=$save.Invoke($null,@($dir,'a@example.test',$changed,$card)); throw 'Cross-account write accepted' }
        catch [Management.Automation.MethodInvocationException] {
            if ($_.Exception.GetBaseException() -isnot [InvalidOperationException]) {throw}
        }
    }
    if ($load.Invoke($null,@($dir,'a@example.test')).Name -ne 'Alice') {throw 'Rejected save modified account A'}
    $index=Join-Path $dir 'profiles.json'
    Remove-Item -LiteralPath $index
    $null=$list.Invoke($null,@($dir,'b@example.test'))
    $profiles=@($list.Invoke($null,@($dir,'a@example.test')))
    if ($profiles.Count -ne 2) {throw 'Legacy cards were not indexed after each account returned'}
    if ((Get-Content -Raw -LiteralPath $index) -match '@') {throw 'Profile index exposed an email'}
    $bobKey=($profiles | Where-Object Label -eq 'Bob').Key
    try { $null=$queue.Invoke($null,@($dir,'a@example.test','b@example.test',$bobKey)); throw 'Changed account queued another card' }
    catch [Management.Automation.MethodInvocationException] { if ($_.Exception.GetBaseException() -isnot [InvalidOperationException]) {throw} }
    $null=$queue.Invoke($null,@($dir,'a@example.test','A@example.test',$bobKey))
    if ($launch.Invoke($null,@($dir,'a@example.test')).Name -ne 'Bob') {throw 'One-time selection did not load'}
    if ($launch.Invoke($null,@($dir,'a@example.test')).Name -ne 'Alice') {throw 'Selection was not consumed'}
    $null=$queue.Invoke($null,@($dir,'a@example.test','a@example.test',$bobKey))
    if ($launch.Invoke($null,@($dir,$null)).Name -ne '') {throw 'Guest received selected card'}
    if ($launch.Invoke($null,@($dir,'a@example.test')).Name -ne 'Alice') {throw 'Guest did not clear selection'}
    $null=$queue.Invoke($null,@($dir,'a@example.test','a@example.test',$bobKey))
    if ($launch.Invoke($null,@($dir,'c@example.test')).Name -ne '') {throw 'Changed account received selected card'}
    try { $null=$reset.Invoke($null,@($dir,'a@example.test','b@example.test',$bobKey)); throw 'Changed account reset another card' }
    catch [Management.Automation.MethodInvocationException] { if ($_.Exception.GetBaseException() -isnot [InvalidOperationException]) {throw} }
    $null=$reset.Invoke($null,@($dir,'a@example.test','a@example.test',$bobKey))
    if ($load.Invoke($null,@($dir,'b@example.test')).Name -ne '') {throw 'Selected card was not reset'}
    if ($load.Invoke($null,@($dir,'a@example.test')).Name -ne 'Alice') {throw 'Reset changed another card'}
    'PASS: separate accounts, one-time selection, guest/account-change fallback, single-card reset'
} finally {
    if(Test-Path -LiteralPath $dir){Get-ChildItem -LiteralPath $dir -File | Remove-Item -Force; Remove-Item -LiteralPath $dir}
}
