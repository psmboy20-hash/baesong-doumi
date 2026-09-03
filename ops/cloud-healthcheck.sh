#!/usr/bin/env bash
set -euo pipefail

if curl --fail --silent --max-time 10 http://127.0.0.1:8899/healthz >/dev/null; then
  exit 0
fi

logger -t ham-healthcheck 'health check failed; restarting ham'
sudo systemctl restart ham
sleep 3
curl --fail --silent --max-time 10 http://127.0.0.1:8899/healthz >/dev/null
