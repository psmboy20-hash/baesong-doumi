#!/bin/bash
# 오라클 장부를 받아서 맥미니를 메인 서버로 켠다 (오라클은 먼저 꺼 둔 상태여야 함 — 카페24 연결이 둘로 갈라지지 않게).
#   cd ~/ham && git pull --ff-only && bash ops/macos/become-main.sh <받을주소> <암호>
# 받을 파일은 오라클에서 aes-256-gcm(키=sha256(암호))으로 잠근 data 폴더 묶음: iv(12)+tag(16)+본문.
set -euo pipefail
APP="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP"
if [ -z "${1:-}" ] || [ -z "${2:-}" ]; then echo "쓰는 법: bash ops/macos/become-main.sh <받을주소> <암호>"; exit 1; fi

TS="$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)"
if ! "$TS" status >/dev/null 2>&1; then
  echo "❌ Tailscale이 꺼져 있거나 로그인이 안 됐어요. 메뉴 막대 Tailscale 아이콘 → Log in / Connect 후 다시 실행해 주세요."
  exit 1
fi

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
echo "▶ 오라클 장부 받기"
curl -fsSL "$1" -o "$tmp/data.enc"
node -e '
const fs = require("fs"), c = require("crypto");
const [src, dst, pass] = process.argv.slice(1);
const buf = fs.readFileSync(src);
const d = c.createDecipheriv("aes-256-gcm", c.createHash("sha256").update(pass).digest(), buf.subarray(0, 12));
d.setAuthTag(buf.subarray(12, 28));
fs.writeFileSync(dst, Buffer.concat([d.update(buf.subarray(28)), d.final()]));
' "$tmp/data.enc" "$tmp/data.tgz" "$2"

echo "▶ 맥미니 옛 장부는 옆으로 보관"
launchctl bootout "gui/$(id -u)/com.nusolvere.ham" 2>/dev/null || true
[ -d data ] && mv data "data.before-main-$(date +%Y%m%d-%H%M%S)"
mkdir data
tar -xzf "$tmp/data.tgz" -C data

bash ops/macos/setup-macmini.sh

echo "▶ 바깥 주소(Funnel) 열기"
"$TS" funnel --bg 8899 >/dev/null
"$TS" funnel status
echo "✅ 끝났어요. 위 https 주소가 배송도우미 새 주소예요."
