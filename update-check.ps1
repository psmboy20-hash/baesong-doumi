# 배송 도우미 - 자동 업데이트 확인
# 컴퓨터가 켜질 때 GitHub에서 새 버전이 있는지 보고, 있으면 갈아끼운다.
# 장부(data 폴더)는 절대 건드리지 않는다. 인터넷이 안 되면 조용히 넘어간다.
$ErrorActionPreference = 'SilentlyContinue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = 'psmboy20-hash/baesong-doumi'
$log = Join-Path $here 'update.log'

function Log($m) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding utf8 }

try {
    $localVer = [version](Get-Content (Join-Path $here 'version.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $remoteRaw = Invoke-RestMethod -Uri "https://raw.githubusercontent.com/$repo/main/version.json" -TimeoutSec 10
    $remoteVer = [version]$remoteRaw.version
    if ($remoteVer -le $localVer) { exit }

    Log "새 버전 발견: $localVer -> $remoteVer. 내려받는 중..."
    $tmp = Join-Path $env:TEMP 'baesong-update'
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $tmp | Out-Null
    $zip = Join-Path $tmp 'update.zip'
    Invoke-WebRequest -Uri "https://codeload.github.com/$repo/zip/refs/heads/main" -OutFile $zip -TimeoutSec 60 -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $src = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like 'baesong-doumi-*' } | Select-Object -First 1
    if (-not $src) { Log "압축 안에서 파일을 못 찾음"; exit }

    # data/는 zip에 없으므로 안전. 그래도 혹시 몰라 한 번 더 방어.
    Remove-Item (Join-Path $src.FullName 'data') -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $src.FullName '*') $here -Recurse -Force
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Log "업데이트 완료: $remoteVer"
} catch {
    Log ("업데이트 확인 실패(무시함): " + $_.Exception.Message)
}
