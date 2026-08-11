# Registers a one-time Scheduled Task at 17:00 today to autonomously continue the cheder-v3 build.
$pyw = 'C:\Users\5F4C~1\AppData\Local\Programs\Python\Python311\pythonw.exe'
$scr = 'C:\projects\cheder-v3\_continue_build.py'
$act = New-ScheduledTaskAction -Execute $pyw -Argument ('"' + $scr + '"') -WorkingDirectory 'C:\projects\cheder-v3'
$trg = New-ScheduledTaskTrigger -Once -At '17:00'
$set = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 6)
Register-ScheduledTask -TaskName 'cheder_v3_continue_1700' -Action $act -Trigger $trg -Settings $set -Description 'cheder-v3 autonomous build continue at 17:00' -Force | Out-Null
Write-Output 'TASK_CREATED'
