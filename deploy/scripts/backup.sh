#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

database_path="${DATABASE_PATH:-/var/lib/isabel/isabel.sqlite}"
backup_dir="${BACKUP_DIR:-/var/backups/isabel}"

if [[ ! -f "$database_path" ]]; then
  echo "Banco SQLite não encontrado em $database_path" >&2
  exit 1
fi

mkdir -p "$backup_dir"
timestamp="$(date -u +'%Y-%m-%dT%H-%M-%SZ')"
temporary_file="$backup_dir/.isabel-$timestamp.sqlite3.tmp"
final_file="$backup_dir/isabel-$timestamp.sqlite3"

sqlite3 "$database_path" ".timeout 10000" ".backup '$temporary_file'"
mv "$temporary_file" "$final_file"
sha256sum "$final_file" > "$final_file.sha256"

find "$backup_dir" -maxdepth 1 -type f \( -name 'isabel-*.sqlite3' -o -name 'isabel-*.sqlite3.sha256' \) -mtime +6 -delete
echo "Backup criado: $final_file"
