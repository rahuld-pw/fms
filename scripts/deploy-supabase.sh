#!/usr/bin/env bash
# Configures a hosted Supabase project for Campus Ops:
#   schema + (optional) demo seed, Vault secrets for pg_cron dispatch, auth
#   settings (site URL, redirect URLs, email-code template), Edge Functions and
#   their secrets.
#
# Required env:
#   SUPABASE_ACCESS_TOKEN   personal access token (supabase.com/dashboard/account/tokens)
#   SUPABASE_PROJECT_REF    e.g. abcdefghijklmnopqrst
#   SUPABASE_DB_PASSWORD    database password chosen when the project was created
#   SUPABASE_SERVICE_ROLE_KEY  Project Settings → API → service_role
#   APP_URL                 public URL of the Vercel deployment, e.g. https://campus-ops.vercel.app
# Optional env:
#   SEED=1                  load the Greenfield demo organisation
#   RESEND_API_KEY, EMAIL_FROM, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_LANG
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?}" "${SUPABASE_PROJECT_REF:?}" "${SUPABASE_DB_PASSWORD:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}" "${APP_URL:?}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SB="npx --yes supabase@latest"
REF="$SUPABASE_PROJECT_REF"
API="https://api.supabase.com/v1/projects/$REF"
APP_URL="${APP_URL%/}"

echo "→ Linking project $REF"
$SB link --project-ref "$REF" --password "$SUPABASE_DB_PASSWORD"

echo "→ Applying migrations${SEED:+ and seed}"
if [[ "${SEED:-0}" == "1" ]]; then $SB db push --include-seed --password "$SUPABASE_DB_PASSWORD" --yes
else $SB db push --password "$SUPABASE_DB_PASSWORD" --yes; fi

echo "→ Vault secrets used by pg_cron to call the Edge Functions"
sql() { curl -fsS -X POST "$API/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "content-type: application/json" -d "$(jq -n --arg q "$1" '{query:$q}')" > /dev/null; }
upsert_secret() {
  sql "select vault.update_secret(id, '$2') from vault.secrets where name = '$1';
       select vault.create_secret('$2', '$1') where not exists (select 1 from vault.secrets where name = '$1');"
}
upsert_secret project_url "https://$REF.supabase.co"
upsert_secret service_role_key "$SUPABASE_SERVICE_ROLE_KEY"

echo "→ Auth: site URL, redirect URLs, email + password and email-code sign-in"
TEMPLATE="$(cat supabase/templates/magic_link.html)"
curl -fsS -X PATCH "$API/config/auth" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "content-type: application/json" -d "$(jq -n \
  --arg site "$APP_URL" --arg allow "$APP_URL/**,http://localhost:3000/**" --arg tpl "$TEMPLATE" '{
    site_url: $site,
    uri_allow_list: $allow,
    external_email_enabled: true,
    mailer_otp_exp: 600,
    mailer_otp_length: 6,
    mailer_subjects_magic_link: "Your Campus Ops sign-in code",
    mailer_templates_magic_link_content: $tpl
  }')" > /dev/null

echo "→ Edge Functions"
$SB functions deploy dispatch-webhooks --project-ref "$REF" --no-verify-jwt
$SB functions deploy dispatch-messages --project-ref "$REF" --no-verify-jwt
SECRETS=("APP_URL=$APP_URL")
for k in RESEND_API_KEY EMAIL_FROM WHATSAPP_TOKEN WHATSAPP_PHONE_NUMBER_ID WHATSAPP_LANG; do
  [[ -n "${!k:-}" ]] && SECRETS+=("$k=${!k}")
done
$SB secrets set --project-ref "$REF" "${SECRETS[@]}"

echo "✓ Supabase project $REF is configured."
echo "  Note: the default Supabase mailer is rate-limited; set up custom SMTP (Authentication → Emails) before going live."
