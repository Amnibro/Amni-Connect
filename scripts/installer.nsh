!macro customInstall
  nsExec::ExecToLog `schtasks /delete /tn AmniControlElevated /f`
  FileOpen $0 "$INSTDIR\resources\amni-control-task.xml" w
  FileWriteUTF16LE /BOM $0 `<?xml version="1.0" encoding="UTF-16"?>$\r$\n`
  FileWriteUTF16LE $0 `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">$\r$\n`
  FileWriteUTF16LE $0 `  <RegistrationInfo><Description>Amni-Connect elevated input daemon</Description></RegistrationInfo>$\r$\n`
  FileWriteUTF16LE $0 `  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>$\r$\n`
  FileWriteUTF16LE $0 `  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>$\r$\n`
  FileWriteUTF16LE $0 `  <Settings>$\r$\n`
  FileWriteUTF16LE $0 `    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>$\r$\n`
  FileWriteUTF16LE $0 `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>$\r$\n`
  FileWriteUTF16LE $0 `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>$\r$\n`
  FileWriteUTF16LE $0 `    <AllowHardTerminate>true</AllowHardTerminate>$\r$\n`
  FileWriteUTF16LE $0 `    <StartWhenAvailable>true</StartWhenAvailable>$\r$\n`
  FileWriteUTF16LE $0 `    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>$\r$\n`
  FileWriteUTF16LE $0 `    <AllowStartOnDemand>true</AllowStartOnDemand>$\r$\n`
  FileWriteUTF16LE $0 `    <Enabled>true</Enabled>$\r$\n`
  FileWriteUTF16LE $0 `    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>$\r$\n`
  FileWriteUTF16LE $0 `    <Priority>5</Priority>$\r$\n`
  FileWriteUTF16LE $0 `  </Settings>$\r$\n`
  FileWriteUTF16LE $0 `  <Actions Context="Author"><Exec><Command>$INSTDIR\resources\amni-control.exe</Command><WorkingDirectory>$INSTDIR\resources</WorkingDirectory></Exec></Actions>$\r$\n`
  FileWriteUTF16LE $0 `</Task>$\r$\n`
  FileClose $0
  nsExec::ExecToLog `schtasks /create /tn AmniControlElevated /xml "$INSTDIR\resources\amni-control-task.xml" /f`
!macroend
!macro customUnInstall
  nsExec::ExecToLog `schtasks /end /tn AmniControlElevated`
  nsExec::ExecToLog `taskkill /F /IM amni-control.exe`
  nsExec::ExecToLog `schtasks /delete /tn AmniControlElevated /f`
!macroend
