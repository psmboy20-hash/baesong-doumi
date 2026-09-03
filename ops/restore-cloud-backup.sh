#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  printf 'usage: %s <ham-backup-*.tar.gz.enc> [output-directory]\n' "$0" >&2
  exit 2
fi

backup_file="$1"
output_dir="${2:-$(pwd)/ham-restored-$(date +%Y%m%d-%H%M%S)}"
passphrase_file="${HAM_BACKUP_PASSPHRASE:-$HOME/.ssh/ham-backup.pass}"
openssl_bin="${HAM_OPENSSL_BIN:-openssl}"
openssl_passphrase_file="$passphrase_file"
if command -v cygpath >/dev/null 2>&1; then
  openssl_passphrase_file="$(cygpath -w "$passphrase_file")"
fi
mkdir -p "$output_dir"
archive_file="$output_dir/restore.tar.gz"

"$openssl_bin" enc -d -aes-256-cbc -pbkdf2 \
  -in "$backup_file" -out "$archive_file" -pass "file:$openssl_passphrase_file"
tar -xzf "$archive_file" -C "$output_dir"
rm -f "$archive_file"
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync(process.argv[1],'utf8'));" "$output_dir/data/db.json"
printf '%s\n' "$output_dir"
