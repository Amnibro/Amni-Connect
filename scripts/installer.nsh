!macro customInstall
  nsExec::ExecToLog 'schtasks /create /tn AmniControlElevated /tr $\"$INSTDIR\resources\amni-control.exe$\" /sc onlogon /rl HIGHEST /f /it'
!macroend

!macro customUnInstall
  nsExec::ExecToLog `schtasks /delete /tn AmniControlElevated /f`
!macroend
