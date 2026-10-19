#!/usr/bin/env bash
# Prisma's ?schema= parameter is not a libpq URL option; remove only that key
# before passing DATABASE_URL to PostgreSQL command-line tools.
backup_libpq_url() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
parts = urlsplit(sys.argv[1])
query = sorted((key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key != "schema")
print(urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)), end="")
PY
}

backup_database_identity() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlsplit
parts = urlsplit(sys.argv[1])
print("|".join((parts.scheme.lower(), (parts.hostname or "").lower(), str(parts.port or ""), parts.path.rstrip("/"))), end="")
PY
}
