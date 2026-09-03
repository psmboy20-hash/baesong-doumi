#!/usr/bin/env bash
set -euo pipefail

SERVER="${HAM_BACKUP_SERVER:-ubuntu@140.238.54.44}"
KEY_FILE="${HAM_BACKUP_SSH_KEY:-$HOME/.ssh/baesong-server}"
PASSPHRASE_FILE="${HAM_BACKUP_PASSPHRASE:-$HOME/.ssh/ham-backup.pass}"
if command -v cygpath >/dev/null 2>&1 && [ -n "${USERPROFILE:-}" ]; then
  default_backup_dir="$(cygpath -u "$USERPROFILE")/Documents/배송도우미-외부백업"
else
  default_backup_dir="$HOME/배송도우미-외부백업"
fi
BACKUP_DIR="${HAM_BACKUP_DIR:-$default_backup_dir}"
OPENSSL_BIN="${HAM_OPENSSL_BIN:-openssl}"

mkdir -p "$BACKUP_DIR"
if [ ! -s "$PASSPHRASE_FILE" ]; then
  umask 077
  "$OPENSSL_BIN" rand -hex 32 > "$PASSPHRASE_FILE"
fi
openssl_passphrase_file="$PASSPHRASE_FILE"
if command -v cygpath >/dev/null 2>&1; then
  openssl_passphrase_file="$(cygpath -w "$PASSPHRASE_FILE")"
fi

stamp="$(date +%Y%m%d-%H%M%S)"
remote_file="/tmp/ham-backup-$stamp.tar.gz"
plain_file="$BACKUP_DIR/ham-backup-$stamp.tar.gz"
encrypted_file="$plain_file.enc"

cleanup() {
  rm -f "$plain_file"
  ssh -o BatchMode=yes -i "$KEY_FILE" "$SERVER" "rm -f '$remote_file'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ssh -o BatchMode=yes -i "$KEY_FILE" "$SERVER" \
  "tar -C /home/ubuntu/ham -czf '$remote_file' data"
scp -q -i "$KEY_FILE" "$SERVER:$remote_file" "$plain_file"
"$OPENSSL_BIN" enc -aes-256-cbc -pbkdf2 -salt \
  -in "$plain_file" -out "$encrypted_file" -pass "file:$openssl_passphrase_file"
test -s "$encrypted_file"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ham-backup-*.tar.gz.enc' -mtime +30 -delete
printf '%s\n' "$encrypted_file"
