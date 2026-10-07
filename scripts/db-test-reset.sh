#!/usr/bin/env bash
# Recreates a plain-Postgres test database with Supabase stubs + all migrations.
# Usage: TEST_DATABASE_URL=postgres://postgres@localhost:5432/campus_ops_test scripts/db-test-reset.sh
set -euo pipefail
URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/campus_ops_test}"
DB="${URL##*/}"; DB="${DB%%\?*}"
ADMIN_URL="${URL%/*}/postgres"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
psql "$URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/tests/db/supabase-stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null || { echo "FAILED: $f"; exit 1; }
done
if [[ "${WITH_SEED:-0}" == "1" ]]; then
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed.sql" > /dev/null
fi
echo "test database ready: $DB"
