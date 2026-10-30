; electron-builder includes this file in the installer and the uninstaller. Windows will not replace or
; delete an executable that runs, and the background task starts `resources\bin\ruimte.exe` again every
; minute, so both stop it through `stop-machine.ps1` before touching a file. An update goes the same way,
; since electron-updater runs this installer with `--updated`.

!define MACHINE_TASK "app.ruimte.daemon"

Var machineTaskDisabled

; Replaces electron-builder's check, which force-stops the daemon but leaves the task to start it again.
!macro customCheckAppRunning
  InitPluginsDir
  File "/oname=$PLUGINSDIR\stop-machine.ps1" "${BUILD_RESOURCES_DIR}\stop-machine.ps1"

  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-machine.ps1" -InstallDir "$INSTDIR" -Action check`
  Pop $R0
  ${if} $R0 == 0
    ; An update's person answered in the app, and the old uninstaller finds nothing left by now.
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
      Quit
    ${endIf}
  ${endIf}

  retryStopMachine:
  DetailPrint "$(appClosing)"
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-machine.ps1" -InstallDir "$INSTDIR" -Action stop`
  Pop $R0
  ; Remembered here, since a retry finds the task already off and cannot tell who turned it off.
  ${if} $R0 == 3
  ${orIf} $R0 == 4
    StrCpy $machineTaskDisabled "1"
  ${endIf}
  ${if} $R0 == 2
  ${orIf} $R0 == 4
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY retryStopMachine
    ${if} $machineTaskDisabled == "1"
      nsExec::Exec `"$SYSDIR\schtasks.exe" /Change /TN "${MACHINE_TASK}" /ENABLE`
      Pop $R0
    ${endIf}
    Quit
  ${endIf}
!macroend

; What this install stopped comes back, also when nobody opens the app. A task the person had off stays off.
!macro customInstall
  ${if} $machineTaskDisabled == "1"
    nsExec::Exec `"$SYSDIR\schtasks.exe" /Change /TN "${MACHINE_TASK}" /ENABLE`
    Pop $R0
    nsExec::Exec `"$SYSDIR\schtasks.exe" /Run /TN "${MACHINE_TASK}"`
    Pop $R0
  ${endIf}
!macroend

; An update's old uninstaller keeps the task: the new version's daemon runs from the same path.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-machine.ps1" -InstallDir "$INSTDIR" -Action remove`
    Pop $R0
  ${endIf}
!macroend
