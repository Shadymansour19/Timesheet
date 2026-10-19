#!/usr/bin/env bash
# Applies all migrations + supabase/tests/rls.sql inside ONE transaction and ROLLS BACK,
# so the target database is left untouched. Needs TS_DB_URL (e.g. `set -a; . ./.env.db; set +a`).
# Set SKIP_MIGRATIONS=1 to test against an already-migrated database instead.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${TS_DB_URL:?TS_DB_URL not set}"
{
  echo 'begin;'
  if [ -z "${SKIP_MIGRATIONS:-}" ]; then cat supabase/migrations/*.sql; fi
  cat supabase/tests/rls.sql
  echo 'rollback;'
} | psql "$TS_DB_URL" -v ON_ERROR_STOP=1 -X -q -t -A 2>&1 | sed -E 's/^psql:<stdin>:[0-9]+: //; s/^NOTICE:  //' | grep -E '^(PASS|FAIL|ERROR|DETAIL|CONTEXT|===)'
