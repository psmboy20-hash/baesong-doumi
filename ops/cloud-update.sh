#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${HAM_APP_DIR:-/home/ubuntu/ham}"
LOG_FILE="${HAM_UPDATE_LOG:-/home/ubuntu/ham-update.log}"

cd "$APP_DIR"
git fetch -q origin main
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/main)"
[ "$local_sha" = "$remote_sha" ] && exit 0

git merge --ff-only -q origin/main
npm ci --omit=dev --no-fund --no-audit
sudo systemctl restart ham
curl --fail --silent --show-error --retry 5 --retry-delay 2 http://127.0.0.1:8899/healthz >/dev/null
printf '%s updated %s -> %s\n' "$(date -Is)" "$local_sha" "$remote_sha" >> "$LOG_FILE"
