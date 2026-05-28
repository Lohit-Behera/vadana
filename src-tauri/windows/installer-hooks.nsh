; Uninstall cleanup for custom user paths (models folder, backend .venv, legacy dirs).
; Tauri removes %APPDATA%\${BUNDLEID} after this hook when "Delete application data" is checked.

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    ; Read uninstall-paths.json while app data still exists; removes custom models + .venv.
    IfFileExists "$INSTDIR\resources\cleanup-appdata.ps1" 0 +2
      ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\cleanup-appdata.ps1"' $0
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    ; Legacy / default paths if manifest was missing or incomplete.
    RmDir /r "$LOCALAPPDATA\vadana"
    RmDir /r "$PROFILE\vadana"
  ${EndIf}
!macroend
