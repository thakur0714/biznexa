#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${UPLOAD_DIR:?UPLOAD_DIR must be set}"
source "$(dirname "$0")/connection-url.sh"
database_url=$(backup_libpq_url "$DATABASE_URL")
command -v psql >/dev/null && command -v createdb >/dev/null && command -v dropdb >/dev/null || { echo "psql, createdb and dropdb are required" >&2; exit 1; }
work_dir=$(mktemp -d)
temp_db="bn_restore_verify_$(date -u +%Y%m%d%H%M%S)_$$"
temp_uploads="$work_dir/uploads"
mkdir -p "$temp_uploads"
cleanup() {
  dropdb --if-exists --maintenance-db="$database_url" "$temp_db" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT
BACKUP_DIR="$work_dir/backup" scripts/backup/backup.sh --retention-days 0 --output-dir "$work_dir/backup"
createdb --maintenance-db="$database_url" "$temp_db"
python3 - "$database_url" "$temp_db" >"$work_dir/temp-url" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
parts = urlsplit(sys.argv[1])
print(urlunsplit((parts.scheme, parts.netloc, "/" + sys.argv[2], parts.query, parts.fragment)), end="")
PY
temp_url=$(cat "$work_dir/temp-url")
pg_restore --clean --if-exists --no-owner --dbname="$temp_url" "$work_dir"/backup/database-*.dump
tar -xzf "$work_dir"/backup/uploads-*.tar.gz -C "$temp_uploads"
psql "$database_url" -Atc "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename" > "$work_dir/tables"
total=0
while IFS= read -r table; do
  [[ -n "$table" ]] || continue
  source_count=$(psql "$database_url" -Atc "SELECT count(*) FROM \"$table\"")
  restored_count=$(psql "$temp_url" -Atc "SELECT count(*) FROM \"$table\"")
  [[ "$source_count" == "$restored_count" ]] || { echo "Mismatch in $table: source=$source_count restored=$restored_count" >&2; exit 1; }
  printf '%s=%s ' "$table" "$source_count"
  total=$((total + 1))
done < "$work_dir/tables"
printf '\nVerified row counts for %s tables; temporary database will be dropped.\n' "$total"
