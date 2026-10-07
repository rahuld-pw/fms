#!/usr/bin/env bash
# Creates/links the Vercel project, sets environment variables and deploys to production.
#
# Required env:
#   VERCEL_TOKEN                  vercel.com/account/tokens
#   NEXT_PUBLIC_SUPABASE_URL      https://<ref>.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
# Optional env:
#   VERCEL_SCOPE                  team slug (personal account if empty)
#   VERCEL_PROJECT=campus-ops     project name
#   NEXT_PUBLIC_APP_URL           defaults to https://<project>.vercel.app
#   NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY
set -euo pipefail
: "${VERCEL_TOKEN:?}" "${NEXT_PUBLIC_SUPABASE_URL:?}" "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROJECT="${VERCEL_PROJECT:-campus-ops}"
V=(npx --yes vercel@latest --token "$VERCEL_TOKEN")
[[ -n "${VERCEL_SCOPE:-}" ]] && V+=(--scope "$VERCEL_SCOPE")
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-https://$PROJECT.vercel.app}"

echo "→ Linking Vercel project $PROJECT"
"${V[@]}" link --yes --project "$PROJECT"

echo "→ Environment variables (production)"
for k in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_APP_URL NEXT_PUBLIC_TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY; do
  [[ -z "${!k:-}" ]] && continue
  for target in production; do
    "${V[@]}" env rm "$k" "$target" --yes > /dev/null 2>&1 || true
    printf '%s' "${!k}" | "${V[@]}" env add "$k" "$target" > /dev/null
  done
  echo "  set $k"
done

echo "→ Deploying to production"
"${V[@]}" deploy --prod --yes
echo "✓ Deployed. App URL: $NEXT_PUBLIC_APP_URL"
