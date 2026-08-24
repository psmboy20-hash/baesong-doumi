' Baesong Doumi silent starter (auto-run at boot)
Set sh = CreateObject("WScript.Shell")
dir = Replace(WScript.ScriptFullName, WScript.ScriptName, "")
sh.CurrentDirectory = dir
' kill old server on port 8899 first (so updated code actually runs)
sh.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr :8899 ^| findstr LISTENING') do taskkill /F /PID %a", 0, True
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & dir & "update-check.ps1""", 0, True
sh.Run "cmd /c node server.js", 0, False
