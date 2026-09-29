#!/usr/bin/env bash
set -euo pipefail

# 한 번에 하나만 — 수동 배포와 10분 cron 이 겹쳐 npm ci 가 동시에 돌면 node_modules 가 비어 앱이 안 뜬다 (2026-09-29 실제 발생)
exec 9>/tmp/ham-update.lock
flock -w 600 9

APP_DIR="${HAM_APP_DIR:-/home/ubuntu/ham}"
LOG_FILE="${HAM_UPDATE_LOG:-/home/ubuntu/ham-update.log}"
DEPLOYED_SHA_FILE="${HAM_DEPLOYED_SHA_FILE:-/home/ubuntu/.ham-deployed-sha}"

cd "$APP_DIR"
git fetch -q origin main
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/main)"
deployed_sha="$(cat "$DEPLOYED_SHA_FILE" 2>/dev/null || true)"
[ "$local_sha" = "$remote_sha" ] && [ "$deployed_sha" = "$remote_sha" ] && exit 0

[ "$local_sha" = "$remote_sha" ] || git merge --ff-only -q origin/main
npm ci --omit=dev --no-fund --no-audit
node -e "require('xlsx')" # 설치가 반쯤 끝난 채로 재시작하지 않게 확인
node --check server.js
for f in public/*.js public/pages/*.js; do node --check "$f"; done
sudo systemctl restart ham
curl --fail --silent --show-error --retry 10 --retry-delay 1 --retry-connrefused http://127.0.0.1:8899/healthz >/dev/null
marker_tmp="${DEPLOYED_SHA_FILE}.tmp.$$"
printf '%s\n' "$remote_sha" > "$marker_tmp"
mv "$marker_tmp" "$DEPLOYED_SHA_FILE"
printf '%s updated %s -> %s\n' "$(date -Is)" "$local_sha" "$remote_sha" >> "$LOG_FILE"
