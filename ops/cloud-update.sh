#!/usr/bin/env bash
set -euo pipefail

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
node --check server.js
node --check public/app.js
node --check public/item-lines.js
sudo systemctl restart ham
curl --fail --silent --show-error --retry 10 --retry-delay 1 --retry-connrefused http://127.0.0.1:8899/healthz >/dev/null
marker_tmp="${DEPLOYED_SHA_FILE}.tmp.$$"
printf '%s\n' "$remote_sha" > "$marker_tmp"
mv "$marker_tmp" "$DEPLOYED_SHA_FILE"
printf '%s updated %s -> %s\n' "$(date -Is)" "$local_sha" "$remote_sha" >> "$LOG_FILE"
