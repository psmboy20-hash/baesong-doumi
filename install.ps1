# 배송 도우미 - 새 컴퓨터 설치 스크립트
# 하는 일: ①Node 확인 ②바탕화면 바로가기 ③부팅 자동시작 등록 ④바로 실행
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host ""
Write-Host "===== 배송 도우미 설치 =====" -ForegroundColor Cyan

# 1. Node.js 확인
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host ""
    Write-Host "[!] Node.js가 아직 설치되지 않았어요." -ForegroundColor Yellow
    Write-Host "    지금 열리는 페이지에서 초록색 LTS 버튼을 눌러 설치한 뒤," -ForegroundColor Yellow
    Write-Host "    이 설치 파일을 다시 실행해 주세요." -ForegroundColor Yellow
    Start-Process "https://nodejs.org/ko"
    Read-Host "아무 키나 누르면 창이 닫힙니다"
    exit
}
Write-Host "[1/4] Node.js 확인 완료 ($($node.Source))"

# 2. 프로그램 파일 확인 (xlsx 모듈 없으면 설치)
if (-not (Test-Path "$here\node_modules\xlsx")) {
    Write-Host "[2/4] 부품(xlsx) 내려받는 중..."
    npm install xlsx --no-fund --no-audit | Out-Null
} else {
    Write-Host "[2/4] 프로그램 부품 확인 완료"
}

# 3. 바로가기 2개 만들기
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$sc1 = $ws.CreateShortcut("$desktop\배송 도우미.lnk")
$sc1.TargetPath = "$here\배송도우미-시작.bat"
$sc1.WorkingDirectory = $here
$sc1.IconLocation = "%SystemRoot%\System32\SHELL32.dll,16"
$sc1.Save()
$startup = [Environment]::GetFolderPath('Startup')
$sc2 = $ws.CreateShortcut("$startup\배송 도우미 자동시작.lnk")
$sc2.TargetPath = "$here\배송도우미-백그라운드.vbs"
$sc2.WorkingDirectory = $here
$sc2.Save()
Write-Host "[3/4] 바탕화면 아이콘 + 부팅 자동시작 등록 완료"

# 4. 지금 바로 실행
Start-Process wscript.exe -ArgumentList "`"$here\배송도우미-백그라운드.vbs`""
Start-Sleep -Seconds 2
Start-Process "http://localhost:8899"
Write-Host "[4/4] 프로그램을 켰어요! 브라우저에 화면이 열립니다."
Write-Host ""
Write-Host "설치 끝! 앞으로는 컴퓨터만 켜면 자동으로 돌아갑니다." -ForegroundColor Green
Read-Host "아무 키나 누르면 창이 닫힙니다"
