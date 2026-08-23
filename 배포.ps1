# 배송 도우미 - 업데이트 배포 (노트북에서만 사용)
# 버전을 하나 올리고 GitHub에 올린다. 다른 PC들은 켜질 때 자동으로 받아간다.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$v = (Get-Content version.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$p = $v.Split('.')
$newVer = "$($p[0]).$($p[1]).$([int]$p[2] + 1)"
[IO.File]::WriteAllText((Join-Path $here 'version.json'), ('{ "version": "' + $newVer + '" }' + "`n"), (New-Object System.Text.UTF8Encoding $false))

git add -A
git commit -m "update v$newVer"
git push
Write-Host ""
Write-Host "배포 완료! v$newVer — 다른 컴퓨터들은 다음에 켜질 때 자동으로 업데이트됩니다." -ForegroundColor Green
Read-Host "아무 키나 누르면 창이 닫힙니다"
