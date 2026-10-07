#!/usr/bin/env bash
# Docker-free local stack for end-to-end API tests:
#   Postgres (migrations + seed) -> PostgREST (:3001) -> gateway (:54321)
# Requires: a local Postgres reachable via TEST_DATABASE_URL and a PostgREST
# binary (POSTGREST_BIN, https://github.com/PostgREST/postgrest/releases).
#   scripts/e2e-stack.sh            # (re)start everything with fresh data
# then run `npm run dev` with the printed env and `npm run test:e2e`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/campus_ops_test}"
BIN="${POSTGREST_BIN:-postgrest}"
LOGS="${E2E_LOG_DIR:-/tmp}"

kill $(pgrep -x postgrest) 2>/dev/null || true
kill $(pgrep -f "tests/e2e/gateway.mjs") 2>/dev/null || true

WITH_SEED=1 "$ROOT/scripts/db-test-reset.sh"
psql "$URL" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'authpass' noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
SQL

DB_NAME="${URL##*/}"
sed "s#campus_ops_test#${DB_NAME%%\?*}#" "$ROOT/tests/e2e/postgrest.conf" > "$LOGS/postgrest.conf"
nohup "$BIN" "$LOGS/postgrest.conf" > "$LOGS/postgrest.log" 2>&1 &
nohup node "$ROOT/tests/e2e/gateway.mjs" > "$LOGS/gateway.log" 2>&1 &
sleep 2
ANON=$(grep ANON_KEY "$LOGS/gateway.log" | cut -d= -f2)
SRK=$(grep SERVICE_ROLE_KEY "$LOGS/gateway.log" | cut -d= -f2)
cat <<ENV
Stack is up. Use these env vars for the app (e.g. in .env.local):
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SRK
NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV
