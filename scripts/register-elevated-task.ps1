$log = Join-Path $env:TEMP 'amni-task-register.log'
function L($m) { Add-Content $log ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
$exe = 'C:\Program Files\Amni-Connect\resources\amni-control.exe'
try {
  L "start $exe"
  if (-not (Test-Path $exe)) { throw "missing $exe" }
  $action = New-ScheduledTaskAction -Execute $exe
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
  Unregister-ScheduledTask -TaskName AmniControlElevated -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName AmniControlElevated -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName AmniControlElevated -ErrorAction SilentlyContinue
  L "ok"
} catch {
  L ("FAIL " + $_.Exception.Message)
  exit 1
}
