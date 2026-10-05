#!/bin/bash
# 맥미니 자동 업데이트 (launchd 가 10분마다 실행). 깃에 새 버전이 있으면 받아서 검사하고 다시 켠다.
set -euo pipefail
APP="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP"
LOCK="/tmp/ham-update.lock.d"
# 한 번에 하나만 — 겹쳐서 npm ci 가 동시에 돌면 패키지가 비어 앱이 안 뜬다 (2026-09-29 클라우드에서 실제 발생)
# 강제 종료로 잠금이 남으면 업데이트가 영영 멈추므로, 30분 넘은 잠금은 치운다
find "$LOCK" -maxdepth 0 -mmin +30 -exec rmdir {} \; 2>/dev/null || true
mkdir "$LOCK" 2>/dev/null || exit 0
trap 'rmdir "$LOCK"' EXIT

git fetch -q origin main
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/main)"
deployed_sha="$(cat "$HOME/.ham-deployed-sha" 2>/dev/null || true)"
[ "$local_sha" = "$remote_sha" ] && [ "$deployed_sha" = "$remote_sha" ] && exit 0

[ "$local_sha" = "$remote_sha" ] || git merge --ff-only -q origin/main
npm ci --omit=dev --no-fund --no-audit
node -e "require('xlsx')"
node --check server.js
for f in public/*.js public/pages/*.js; do node --check "$f"; done
launchctl kickstart -k "gui/$(id -u)/com.nusolvere.ham"
for i in $(seq 1 30); do curl -sf http://127.0.0.1:8899/healthz >/dev/null && break; sleep 1; done
curl -sf http://127.0.0.1:8899/healthz >/dev/null
echo "$remote_sha" > "$HOME/.ham-deployed-sha"
echo "$(date '+%Y-%m-%dT%H:%M:%S%z') updated $local_sha -> $remote_sha"
