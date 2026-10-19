#!/usr/bin/env bash
set -euo pipefail
umask 077

retention_days=14
backup_dir=${BACKUP_DIR:-"$(pwd)/backups"}
while (($#)); do
  case "$1" in
    --retention-days)
      [[ ${2:-} =~ ^[0-9]+$ ]] || { echo "--retention-days requires a non-negative integer" >&2; exit 2; }
      retention_days=$2; shift 2 ;;
    --output-dir)
      [[ -n ${2:-} ]] || { echo "--output-dir requires a directory" >&2; exit 2; }
      backup_dir=$2; shift 2 ;;
    *) echo "Usage: backup.sh [--retention-days DAYS] [--output-dir DIR]" >&2; exit 2 ;;
  esac
done
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${UPLOAD_DIR:?UPLOAD_DIR must be set}"
source "$(dirname "$0")/connection-url.sh"
database_url=$(backup_libpq_url "$DATABASE_URL")
[[ -d "$UPLOAD_DIR" ]] || { echo "UPLOAD_DIR does not exist" >&2; exit 1; }
command -v pg_dump >/dev/null || { echo "pg_dump is required" >&2; exit 1; }
command -v tar >/dev/null || { echo "tar is required" >&2; exit 1; }
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
db_file="$backup_dir/database-$stamp.dump"
uploads_file="$backup_dir/uploads-$stamp.tar.gz"
pg_dump --format=custom --no-owner --file="$db_file" "$database_url"
tar -czf "$uploads_file" -C "$UPLOAD_DIR" .
find "$backup_dir" -type f \( -name 'database-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime "+$retention_days" -delete
printf 'Backup created: %s and %s\n' "$db_file" "$uploads_file"
