#!/bin/bash
# 배송도우미를 맥미니에 설치하고 켠다 (메인 서버).
#   1) Node.js 20 이상 설치 (https://nodejs.org → LTS)
#   2) git clone https://github.com/psmboy20-hash/baesong-doumi.git ~/ham
#   3) bash ~/ham/ops/macos/setup-macmini.sh ~/Downloads/ham-data-....zip
# 다시 실행해도 안전하다 (이미 깔린 건 덮어쓰고 다시 켬). 데이터 zip 없이 실행하면 기존 data/ 를 그대로 쓴다.
set -euo pipefail

APP="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP"
LABEL="com.nusolvere.ham"
UPDATE_LABEL="com.nusolvere.ham.update"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs"
UID_NOW="$(id -u)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 없어요. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요."
  exit 1
fi
NODE="$(command -v node)"
major="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then echo "Node.js 20 이상이 필요해요 (지금 $("$NODE" -v))."; exit 1; fi

echo "▶ 필요한 패키지 설치"
npm ci --omit=dev --no-fund --no-audit
"$NODE" -e "require('xlsx')"

if [ -n "${1:-}" ]; then
  echo "▶ 데이터 넣기: $1"
  mkdir -p data
  if [ -f data/db.json ]; then cp data/db.json "data/db.before-macmini-$(date +%Y%m%d-%H%M%S).json"; fi
  unzip -o "$1" -d data >/dev/null
fi
if [ ! -s data/db.json ]; then
  echo "data/db.json 이 없어요. 받은 데이터 zip 경로를 붙여서 다시 실행해 주세요:"
  echo "  bash $APP/ops/macos/setup-macmini.sh ~/Downloads/ham-data-....zip"
  exit 1
fi
chmod 700 data

mkdir -p "$AGENTS" "$LOGS"
echo "▶ 켜질 때 자동 실행 등록"
cat > "$AGENTS/$LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$APP/server.js</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>EnvironmentVariables</key><dict>
    <key>NODE_ENV</key><string>production</string>
    <key>HAM_CLOUD_WRITER</key><string>1</string>
    <key>HAM_PORT</key><string>8899</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/ham.log</string>
  <key>StandardErrorPath</key><string>$LOGS/ham.log</string>
</dict></plist>
EOF

echo "▶ 10분마다 자동 업데이트 등록 (깃에 새 버전이 올라오면 받아서 다시 켬)"
cat > "$AGENTS/$UPDATE_LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$UPDATE_LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$APP/ops/macos/update.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin</string></dict>
  <key>StartInterval</key><integer>600</integer>
  <key>StandardOutPath</key><string>$LOGS/ham-update.log</string>
  <key>StandardErrorPath</key><string>$LOGS/ham-update.log</string>
</dict></plist>
EOF

for label in "$LABEL" "$UPDATE_LABEL"; do
  launchctl bootout "gui/$UID_NOW/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NOW" "$AGENTS/$label.plist"
done
git rev-parse HEAD > "$HOME/.ham-deployed-sha"

echo "▶ 켜졌는지 확인"
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8899/healthz >/dev/null; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '맥미니-주소')"
    echo ""
    echo "✅ 배송도우미가 켜졌어요."
    echo "   맥미니에서:        http://localhost:8899"
    echo "   같은 공유기 PC에서: http://$ip:8899"
    echo ""
    echo "맥이 잠들면 멈춥니다. 시스템 설정 › 에너지에서 '디스플레이가 꺼져 있을 때 자동으로 잠자기 방지'를 켜 주세요."
    exit 0
  fi
  sleep 1
done
echo "❌ 켜지지 않았어요. 기록을 확인해 주세요: tail -50 $LOGS/ham.log"
exit 1
