#!/usr/bin/env bash
set -euo pipefail
umask 077

target_database=
target_uploads=
backup_dir=
force=false
while (($#)); do
  case "$1" in
    --database) target_database=${2:-}; shift 2 ;;
    --uploads) target_uploads=${2:-}; shift 2 ;;
    --backup-dir) backup_dir=${2:-}; shift 2 ;;
    --force) force=true; shift ;;
    *) echo "Usage: restore.sh --database TARGET_DATABASE_URL --uploads TARGET_DIR --backup-dir BACKUP_DIR [--force]" >&2; exit 2 ;;
  esac
done
[[ -n "$target_database" && -n "$target_uploads" && -n "$backup_dir" ]] || { echo "Target database, upload folder and backup folder are required" >&2; exit 2; }
: "${DATABASE_URL:?DATABASE_URL must be set for the active-database safety check}"
source "$(dirname "$0")/connection-url.sh"
target_database_url=$(backup_libpq_url "$target_database")
active_database_url=$(backup_libpq_url "$DATABASE_URL")
if [[ "$(backup_database_identity "$target_database_url")" == "$(backup_database_identity "$active_database_url")" && "$force" != true ]]; then
  echo "Refusing to restore over DATABASE_URL without --force" >&2
  exit 1
fi
target_uploads_path=$(python3 - "$target_uploads" <<'PY'
import os, sys
print(os.path.realpath(sys.argv[1]), end="")
PY
)
if [[ "$target_uploads_path" == / ]]; then
  echo "Refusing to replace the filesystem root" >&2
  exit 1
fi
if [[ -n ${UPLOAD_DIR:-} ]]; then
  active_uploads_path=$(python3 - "$UPLOAD_DIR" <<'PY'
import os, sys
print(os.path.realpath(sys.argv[1]), end="")
PY
)
  if [[ "$target_uploads_path" == "$active_uploads_path" && "$force" != true ]]; then
    echo "Refusing to restore over UPLOAD_DIR without --force" >&2
    exit 1
  fi
fi
[[ -d "$backup_dir" ]] || { echo "Backup directory does not exist" >&2; exit 1; }
db_files=("$backup_dir"/database-*.dump)
db_file=
uploads_file=
for ((i=${#db_files[@]}-1; i>=0; i--)); do
  candidate_db=${db_files[$i]}
  [[ -f "$candidate_db" ]] || continue
  candidate_stamp=${candidate_db##*/database-}
  candidate_stamp=${candidate_stamp%.dump}
  candidate_uploads="$backup_dir/uploads-$candidate_stamp.tar.gz"
  if [[ -f "$candidate_uploads" ]]; then
    db_file=$candidate_db
    uploads_file=$candidate_uploads
    break
  fi
done
[[ -n "$db_file" && -n "$uploads_file" ]] || { echo "No matching database/upload backup pair found" >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "pg_restore is required" >&2; exit 1; }
command -v tar >/dev/null || { echo "tar is required" >&2; exit 1; }
pg_restore --clean --if-exists --no-owner --dbname="$target_database_url" "$db_file"
mkdir -p "$target_uploads"
find "$target_uploads" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
tar -xzf "$uploads_file" -C "$target_uploads"
echo "Restore completed into the explicitly provided targets."
