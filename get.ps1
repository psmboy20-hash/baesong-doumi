# 배송 도우미 - 한 줄 설치 스크립트
# 사용법(cmd에 붙여넣기):
# powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/psmboy20-hash/baesong-doumi/main/get.ps1 | iex"
$ErrorActionPreference = 'Stop'
$dest = 'C:\projects\ham'
Write-Host ""
Write-Host "===== 배송 도우미 내려받기 =====" -ForegroundColor Cyan

New-Item -ItemType Directory -Force $dest | Out-Null
$tmp = Join-Path $env:TEMP 'baesong-setup'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null

Write-Host "[1/3] 최신 프로그램 내려받는 중..."
Invoke-WebRequest 'https://codeload.github.com/psmboy20-hash/baesong-doumi/zip/refs/heads/main' -OutFile (Join-Path $tmp 'a.zip') -UseBasicParsing -TimeoutSec 120

Write-Host "[2/3] 파일 풀어서 넣는 중... ($dest)"
Expand-Archive (Join-Path $tmp 'a.zip') $tmp -Force
Copy-Item (Join-Path $tmp 'baesong-doumi-main\*') $dest -Recurse -Force
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "[3/3] 설치 시작!"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dest 'install.ps1')
