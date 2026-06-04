; Script NSIS custom pentru InspectorCam
; Adaugă excepție Windows Firewall la instalare

!macro customInstall
  ; Excepție Windows Firewall — permite serverul local pe portul 3000
  ExecWait 'netsh advfirewall firewall delete rule name="InspectorCam"'
  ExecWait 'netsh advfirewall firewall add rule name="InspectorCam" dir=in action=allow protocol=TCP localport=3000 description="Server local InspectorCam"'
!macroend

!macro customUninstall
  ; Ștergem excepția Firewall la dezinstalare
  ExecWait 'netsh advfirewall firewall delete rule name="InspectorCam"'
!macroend
