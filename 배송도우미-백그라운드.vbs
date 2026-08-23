' Baesong Doumi silent starter (auto-run at boot)
Set sh = CreateObject("WScript.Shell")
dir = Replace(WScript.ScriptFullName, WScript.ScriptName, "")
sh.CurrentDirectory = dir
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & dir & "update-check.ps1""", 0, True
sh.Run "cmd /c node server.js", 0, False
