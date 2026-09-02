!macro customInstall
  nsExec::ExecToLog `schtasks /delete /tn AmniControlElevated /f`
!macroend

!macro customUnInstall
  nsExec::ExecToLog `schtasks /delete /tn AmniControlElevated /f`
!macroend
