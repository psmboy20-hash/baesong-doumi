#!/usr/bin/env bash
# 서버 장부(data/)를 암호화해 GitHub 비공개 저장소에 밀어넣는다 — 서버가 통째로 사라져도 복원 가능하게.
# 복호화 암호: ~/.ssh/ham-backup.pass (같은 값을 사장님 계정메모에도 보관). 복원: ops/restore-cloud-backup.sh
set -euo pipefail

APP_DIR="${HAM_APP_DIR:-/home/ubuntu/ham}"
REPO_DIR="${HAM_BACKUP_REPO_DIR:-/home/ubuntu/ham-backup}"
REPO_URL="${HAM_BACKUP_REPO_URL:-git@github.com:psmboy20-hash/baesong-backup.git}"
DEPLOY_KEY="${HAM_BACKUP_DEPLOY_KEY:-$HOME/.ssh/ham-backup-deploy}"
PASSPHRASE_FILE="${HAM_BACKUP_PASSPHRASE:-$HOME/.ssh/ham-backup.pass}"
KEEP_DAYS="${HAM_BACKUP_KEEP_DAYS:-60}"
LOG_FILE="${HAM_BACKUP_LOG:-/home/ubuntu/ham-backup.log}"

export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
[ -s "$PASSPHRASE_FILE" ] || { echo "passphrase file missing: $PASSPHRASE_FILE" >&2; exit 1; }

if [ ! -d "$REPO_DIR/.git" ]; then
  git clone -q "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"
git config user.name "baesong-server"
git config user.email "backup@baesong.local"
git pull -q --rebase origin HEAD 2>/dev/null || true

stamp="$(date +%Y%m%d-%H%M%S)"
plain="/tmp/ham-backup-$stamp.tar.gz"
enc="$REPO_DIR/ham-backup-$stamp.tar.gz.enc"
trap 'rm -f "$plain"' EXIT

tar -C "$APP_DIR" -czf "$plain" data
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$plain" -out "$enc" -pass "file:$PASSPHRASE_FILE"
test -s "$enc"

# 오래된 백업 정리 (저장소 크기 관리)
find "$REPO_DIR" -maxdepth 1 -type f -name 'ham-backup-*.tar.gz.enc' -mtime +"$KEEP_DAYS" -delete
printf '# 배송 도우미 암호화 백업\n\n최신: %s\n복호화: `ops/restore-cloud-backup.sh <파일.enc>` (암호는 서버 ~/.ssh/ham-backup.pass / 사장님 계정메모)\n' "$(basename "$enc")" > README.md

git add -A
if git diff --cached --quiet; then
  echo "$(date -Is) nothing to back up" >> "$LOG_FILE"; exit 0
fi
git commit -q -m "backup $stamp"
git push -q origin HEAD:main 2>/dev/null || git push -q -u origin HEAD:main
echo "$(date -Is) pushed $(basename "$enc") ($(du -k "$enc" | cut -f1)KB)" >> "$LOG_FILE"
