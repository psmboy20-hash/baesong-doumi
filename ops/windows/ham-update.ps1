# Baesong-doumi auto update on the Windows main server (same steps as ops/macos/update.sh). Task Scheduler runs it every 10 minutes.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$APP = 'C:\srv\ham'; $OPS = 'C:\srv\ham-ops'; $LOCK = "$OPS\update.lock"; $LOG = 'C:\srv\logs\ham-update.log'
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;" + $env:Path
if ((Test-Path $LOCK) -and ((Get-Item $LOCK).LastWriteTime -lt (Get-Date).AddMinutes(-30))) { Remove-Item $LOCK -Force }
if (Test-Path $LOCK) { exit 0 }
New-Item $LOCK -ItemType File | Out-Null
try {
  Set-Location $APP
  & git fetch -q origin main; if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
  $local = (& git rev-parse HEAD).Trim(); $remote = (& git rev-parse origin/main).Trim()
  $deployed = if (Test-Path "$OPS\deployed-sha") { (Get-Content "$OPS\deployed-sha" -Raw).Trim() } else { '' }
  if ($local -eq $remote -and $deployed -eq $remote) { exit 0 }
  if ($local -ne $remote) { & git merge --ff-only -q origin/main; if ($LASTEXITCODE -ne 0) { throw 'git merge failed' } }
  & npm ci --omit=dev --no-fund --no-audit 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  & node -e "require('xlsx')"; if ($LASTEXITCODE -ne 0) { throw 'xlsx missing' }
  & node --check server.js; if ($LASTEXITCODE -ne 0) { throw 'server.js check failed' }
  foreach ($f in (Get-ChildItem public\*.js, public\pages\*.js)) { & node --check $f.FullName; if ($LASTEXITCODE -ne 0) { throw "check failed $($f.Name)" } }
  (Get-Item "$OPS\restart.request").LastWriteTime = Get-Date
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 2; try { if ((Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8899/healthz -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch {} }
  if (-not $ok) { throw 'healthz did not answer after restart' }
  Set-Content "$OPS\deployed-sha" $remote -Encoding ascii
  Add-Content $LOG "$(Get-Date -Format s) updated $local -> $remote"
} catch { Add-Content $LOG "$(Get-Date -Format s) FAILED: $($_.Exception.Message)" } finally { Remove-Item $LOCK -Force -ErrorAction SilentlyContinue }
