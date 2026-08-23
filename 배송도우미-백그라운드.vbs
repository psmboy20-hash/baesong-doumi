' 배송 도우미 서버를 창 없이 조용히 실행 (컴퓨터 켜질 때 자동 시작용)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\projects\ham"
' 새 버전이 있으면 먼저 받아서 갈아끼운 뒤 실행
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""C:\projects\ham\업데이트확인.ps1""", 0, True
sh.Run "cmd /c node server.js", 0, False
