# Campus Ops

Multi-tenant operations platform for schools and institutes: **Facility management**, **Expense management**, **Task management** and **Purchasing (PO)** on one shared core — organisations, campuses and departments, role-based access enforced in Postgres, a generic approval engine, a versioned REST API with API keys and signed webhooks.

Built with Next.js (App Router, TypeScript strict), Tailwind CSS, shadcn-style components, TanStack Query, Zod, and Supabase (Postgres, Auth, Storage, Realtime, pg_cron, Edge Functions). Deploys to Vercel + Supabase.

---

## Contents

- [What's inside](#whats-inside)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Sign-in methods](#sign-in-methods)
- [Demo data](#demo-data)
- [Configuration](#configuration)
- [API](#api)
- [Webhooks](#webhooks)
- [Background jobs and Edge Functions](#background-jobs-and-edge-functions)
- [Testing](#testing)
- [Deployment](#deployment)
- [Mobile](#mobile)
- [Theming](#theming)
- [Project layout](#project-layout)

---

## What's inside

**Facilities**
- Issues: staff reporting with photos, **anonymous QR reporting** (Turnstile captcha, honeypot, rate limits, tracking link with status, rating and reopen), categories with SLA overrides and auto-assignment, SLA timers and automatic escalation, auto-created work orders or tasks.
- Work orders: checklists, labour/material costs, vendor booking (confirm / reschedule / decline / service report through the vendor portal), verification.
- Assets: register with QR tags and printable labels, depreciation (SLM / WDV), transfers, physical verification audits by QR scan, CSV import with dry run, assets created from goods receipts.
- Vendors: onboarding through a magic-link portal (profile, bank details, documents), approval via the approval engine, ratings, documents with expiry alerts.
- Preventive maintenance schedules, AMC contracts with usage, statutory compliance calendar, unified maintenance calendar.

**Expenses**
- Budgets per fiscal year × campus × department × category, amendments (with approval), carry-forward, ledger of committed vs actual vs available, soft/hard control.
- Claims (reimbursement, advance settlement, petty-cash replenishment) with receipts, per-category limits, budget checks and policy-driven approvals; advances; petty cash funds; recurring expenses.
- Dashboard: budget utilisation, monthly spend, top categories.

**Tasks**
- Projects (from templates), sections, tasks with assignees, followers, subtasks, dependencies (cycle-checked), recurrence, links to any record.
- Views: list, board (drag and drop, touch-friendly), calendar, timeline; My tasks; teams; progress roll-ups.

**Purchasing**
- Requisition → approval → RFQ to several vendors → quote comparison (lowest per line and overall) → award → PO.
- PO with GST (CGST+SGST vs IGST from campus/vendor state), approval with budget check and commitment, PDF, send to vendor, vendor acknowledgement, amendments with version history, cancel/close with vendor rating.
- Goods receipts (GRN) with accepted/rejected quantities and asset creation; vendor invoices with **3-way match** (PO price / GRN quantity / invoice) and tolerances; override with reason; payments with TDS; timeline.
- Number series per campus and fiscal year (e.g. `PO/MAIN/26-27/00001`).

**Cross-cutting**
- Global search (⌘K), notification centre (realtime), role-aware home dashboard and approvals inbox, activity feed and audit log, comments with @mentions, attachments, tags, custom fields, CSV export on every list.
- Settings: organisation and modules, users and scoped role assignments, invitations, roles editor, approval policies (conditions, ordered steps, role / user / permission / department head / reporting manager approvers, N-of-M, SLAs) and delegations, SLAs, number series, fiscal and academic years, categories, custom fields, API keys, webhooks with delivery logs, notification preferences.

## Architecture

```
Browser ──► Next.js (Vercel)
             ├─ App pages (React Server + Client Components, TanStack Query)
             ├─ /api/v1/*  ── one router: auth (session cookie or API key) → module check
             │                → permission → rate limit → idempotency → Zod validation
             │                → service layer → Supabase (RLS as the user)
             └─ proxy.ts (session refresh, redirect signed-out users)
Supabase
  ├─ Postgres: tables, RLS, SECURITY DEFINER workflows (approvals, GRN, 3-way match, …)
  ├─ Auth (email + password, email one-time code)
  ├─ Storage (per-org prefixes, signed URLs)
  ├─ Realtime (notifications, tasks, comments)
  ├─ pg_cron (escalations, reminders, PM generation, recurring expenses, dispatch)
  └─ Edge Functions: dispatch-webhooks, dispatch-messages
```

Key rules the code follows everywhere:

- **Tenancy.** Every row carries `org_id`; RLS restricts reads and writes to organisations the user belongs to. Records are scoped further to campus and department where relevant.
- **RBAC in the database.** `roles`, `role_permissions` and `user_role_assignments` (scope: org, campus or department). `app.has_permission(user, permission, org, campus, department)` is used **inside RLS policies**, and `src/lib/auth/permissions.ts` mirrors the same rules for the server helper and the UI, so the sidebar, buttons and API agree with the database.
- **Modules.** `org_modules` toggles modules per organisation. Disabled modules disappear from navigation and their API routes return `403 module_disabled`.
- **Approvals.** One engine (`approval_policies` → ordered steps → `approval_requests`/`approval_actions`) serves expense claims, advances, budget amendments, requisitions, purchase orders and vendor onboarding. Entity-specific effects are registered handlers.
- **Shared, polymorphic tables** for attachments, comments, activity log, notifications, tags and custom fields, with an entity registry so their RLS follows the parent record.
- **Soft delete + audit.** Business records soft-delete; triggers write field-level changes to `activity_log`.
- **Time and money.** Timestamps stored in UTC and shown in the organisation's time zone; INR by default; fiscal year April–March and a separate academic year.

## Getting started

Prerequisites: Node 20+, the [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker (for `supabase start`).

```bash
npm install
supabase start                      # local Postgres, Auth, Storage, Studio, mail viewer
cp .env.example .env.local          # paste the URL, anon key and service_role key the CLI printed
supabase db reset                   # applies supabase/migrations and supabase/seed.sql
npm run db:types                    # regenerate src/lib/supabase/database.types.ts
npm run dev                         # http://localhost:3000
```

Sign in as `owner@greenfield.test` / `Password123!` (see [Demo data](#demo-data)). Emails sent locally (invitations, sign-in codes) appear in the local mail viewer at http://127.0.0.1:54324.

To start from an empty database instead, skip the seed (`supabase db reset --no-seed`), open `/signup`, create an account and then an organisation at `/onboarding`. Bootstrapping creates the default roles, modules, SLAs, fiscal year and approval policies.

**Docker-free alternative.** If Docker isn't available, `scripts/e2e-stack.sh` runs migrations and seed on a plain Postgres 16, starts PostgREST and a small gateway (`tests/e2e/gateway.mjs`) that emulates the parts of Supabase Auth and Storage the app uses. See [Testing](#testing).

## Sign-in methods

Two methods are offered on `/login`:

1. **Email + password.**
2. **Email + one-time code.** The user enters their email, receives a 6-digit code (`signInWithOtp` with `shouldCreateUser: false`, so only existing users can sign in) and enters it (`verifyOtp`). Codes expire after 10 minutes.

For codes, Supabase's "Magic Link" email template must include `{{ .Token }}`. Locally this is configured in `supabase/config.toml` (`[auth.email.template.magic_link]` → `supabase/templates/magic_link.html`). On a hosted project, paste the same template under **Authentication → Email Templates → Magic Link** and set **OTP expiry** (Authentication → Providers → Email).

Users who signed up with a code can set a password later in **Settings → My profile**. Invitations (`/invite/[token]`) and sign-up use email + password.

## Demo data

`supabase/seed.sql` creates **Greenfield International School** (two campuses, departments, locations with QR codes, vendors, assets, PM schedules, compliance items, issues, budgets, claims, a requisition, an approved and sent PO, projects and tasks). All users share the password `Password123!`:

| Email | Role |
|---|---|
| owner@greenfield.test | Owner (all permissions) |
| facilities@greenfield.test | Facility manager |
| tech@greenfield.test | Technician |
| finance@greenfield.test | Finance manager |
| procurement@greenfield.test | Procurement officer |
| hod.science@greenfield.test | Department head (Science) |
| teacher@greenfield.test | Staff |
| auditor@greenfield.test | Auditor (read-only) |

Try the public QR form at `/q/demo-room-101`. A read-only demo API key is seeded for local development only: `co_live_demo0000000_seedkey-only-for-local-dev-000000`.

## Configuration

Environment variables are documented in [`.env.example`](.env.example). Server variables are validated at start-up (`src/lib/env.ts`) with a readable error listing anything missing.

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server Supabase clients |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only: public endpoints, API-key requests (with the actor passed to Postgres), outboxes |
| `NEXT_PUBLIC_APP_URL` | Links in emails, QR codes, vendor portal links |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Captcha on the anonymous QR form (disabled when empty) |

Organisation-level settings (time zone, currency, fiscal/academic year start, 3-way match tolerances, public reporting, captcha) live in **Settings → Organisation**.

## API

All functionality is available under **`/api/v1`**. The OpenAPI 3.1 document is generated from the route table at `/api/v1/openapi.json` and rendered at **`/docs`**.

**Authentication.** Either the browser session cookie, or an API key:

```bash
curl https://ops.example.com/api/v1/issues?status=open,assigned \
  -H "Authorization: Bearer co_live_xxxxxxxxxxxx_…"
```

API keys are created in **Settings → API keys**, shown once, stored as SHA-256 hashes, scoped (`issue:read`, `po:*`, `*`), rate-limited per key, can expire and can be revoked. A key acts as the user who created it, limited by its scopes; actions are attributed to the key in the audit log. Session users can switch organisations with the `X-Org-Id` header.

**Conventions**

- **Lists**: `?limit=` (≤ 200), `?sort=-created_at`, `?q=` search, filters per resource (`status=open,assigned`, `campus_id=…`, `assignee_id=me`, `created_at_from=…&created_at_to=…`). Pagination by **cursor** (`meta.next_cursor`, keyset on the sort column + id) or `?page=` for offset pagination with totals. Responses: `{ "data": [...], "meta": { "has_more", "next_cursor", "limit" } }`.
- **CSV export**: `GET /<resource>/export` with the same filters (returns `text/csv`).
- **Idempotency**: send `Idempotency-Key` on POST; a retry with the same key and body replays the original response, a different body returns `409 idempotency_conflict`.
- **Errors**: `{ "error": { "code", "message", "details", "request_id" } }` with codes `bad_request`, `validation_failed` (Zod issues in `details`), `unauthorized`, `forbidden`, `module_disabled`, `not_found`, `conflict`, `unprocessable`, `rate_limited` (with `Retry-After`), `idempotency_conflict`, `internal_error`. Every response carries `X-Request-Id`.

## Webhooks

Register endpoints in **Settings → Webhooks** and choose events (`*`, `issue.*`, `purchase_order.*`, `payment.recorded`, `approval.approved`, …). Database triggers write to `events_outbox`; the `dispatch-webhooks` Edge Function delivers them every minute.

Each delivery is a `POST` with JSON `{ id, type, created_at, org_id, data }` and headers:

| Header | |
|---|---|
| `X-CampusOps-Event` | event type |
| `X-CampusOps-Event-Id` | stable event id (use it to de-duplicate) |
| `X-CampusOps-Delivery`, `X-CampusOps-Attempt` | delivery id and attempt number |
| `X-CampusOps-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` |

Verify with your endpoint's signing secret (rotate it from the settings page):

```ts
import { verifySignature } from "./supabase/functions/_shared/signature"; // or copy the 30 lines

const ok = await verifySignature(secret, rawBody, req.headers.get("x-campusops-signature")); // rejects > 5 min old
```

Non-2xx responses and timeouts (10 s) are retried with exponential backoff (1 min doubling, capped at 6 h) up to 8 attempts, then marked `dead`. Deliveries, status codes and response excerpts are listed per endpoint, with manual retry and a test event.

## Background jobs and Edge Functions

`pg_cron` schedules (defined in `20261007000800_platform.sql`, skipped when pg_cron isn't installed):

| Job | Schedule | Does |
|---|---|---|
| `escalate-issues` | every 5 min | escalates issues past their SLA |
| `approval-reminders` | hourly | reminds approvers of overdue steps |
| `pm-work-orders` | daily | generates preventive maintenance work orders |
| `recurring-expenses` | daily | creates recurring expense claims |
| `expiry-alerts` | daily | AMC, vendor document and compliance expiry alerts |
| `task-due-reminders` | daily | due-date reminders |
| `cleanup-ephemeral` | hourly | prunes rate-limit and idempotency rows |
| `dispatch-webhooks`, `dispatch-messages` | every minute | call the Edge Functions via `pg_net` |

The two dispatch jobs need Vault secrets on the hosted project:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service-role-key>', 'service_role_key');
```

Edge Functions (`supabase/functions`, Deno):

- **dispatch-webhooks** — claims due deliveries (`claim_webhook_deliveries`), signs and posts them, records results (`complete_webhook_delivery`).
- **dispatch-messages** — renders queued emails / WhatsApp messages (`_shared/templates.ts`), mints fresh vendor-portal links for vendor messages, sends via **Resend** (email) and **Meta WhatsApp Cloud API**. Without provider keys messages are marked `skipped`, so the queue never backs up.

```bash
supabase functions deploy dispatch-webhooks
supabase functions deploy dispatch-messages
supabase secrets set APP_URL=https://ops.example.com RESEND_API_KEY=re_... EMAIL_FROM="Campus Ops <ops@example.com>"
```

## Testing

| Command | What it runs |
|---|---|
| `npm test` | Unit tests (`tests/unit`): permission evaluation, API-key scopes, CSV (incl. formula-injection guard), cursor pagination, formatting and fiscal years, webhook signatures, message templates |
| `npm run test:db` | Database tests (`tests/db`) on a fresh plain-Postgres database with Supabase stubs: RLS isolation between orgs, campus/department scoping, permission helpers, approval engine (conditions, skips, N-of-M, delegation, self-approval block, rejection), module guards, workflow guards |
| `npm run test:e2e` | API end-to-end flows against a running app (`E2E=1`): issues, scopes, idempotency, cursor paging, asset import, claims, procurement with 3-way match, sourcing (RFQ → award), disabled modules, tasks, public QR, vendor onboarding, OpenAPI |
| `npm run test:smoke` | GETs every list and detail endpoint as a given API key or session |
| `npm run lint`, `npm run typecheck` | ESLint and TypeScript |

UI scripts (Playwright, Chromium): `tests/ui/screens.mjs` (screenshots at desktop and phone width), `tests/ui/mobile-audit.mjs` (horizontal overflow and tap-target audit at 390 px), and end-to-end UI flows in `tests/ui/flows/` (procurement, sourcing, public pages, both sign-in methods).

Running the API and UI tests without Docker:

```bash
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/campus_ops_test
POSTGREST_BIN=/path/to/postgrest npm run e2e:stack   # migrations + seed, PostgREST :3001, gateway :54321
# .env.local → NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 and the demo JWT keys printed by the script
npm run dev &
E2E=1 npm run test:e2e
```

The gateway prints email sign-in codes to its log and exposes them at `GET /__test/otp?email=…` so the code flow can be tested.

## Deployment

1. Create a Supabase project. Link and push the schema: `supabase link --project-ref <ref>` then `supabase db push`. Optionally run `supabase/seed.sql` for a demo org.
2. Enable the `pg_cron` and `pg_net` extensions (Database → Extensions) and create the two Vault secrets above. Re-run the platform migration section or `supabase db push` so the schedules are created.
3. Set the Magic Link email template with `{{ .Token }}` and configure SMTP (Authentication → Emails).
4. Deploy the Edge Functions and set their secrets.
5. Import the repository in Vercel, set the environment variables from `.env.example`, deploy. Set `NEXT_PUBLIC_APP_URL` to the production URL so QR codes and email links are correct.
6. Regenerate types after schema changes: `supabase gen types typescript --project-id <ref> --schema public > src/lib/supabase/database.types.ts`.

## Mobile

The app is designed for phones as much as desktops: a bottom tab bar (Home, Scan, Approvals, Tasks) and slide-out navigation, list pages that switch to compact cards, dialogs that fit small screens, `inputmode`/`autocomplete` hints on forms, camera capture for photos, an in-browser QR scanner (`BarcodeDetector`) with manual fallback, invisible hit-area extension on small controls, a tap-a-day agenda on calendars, and a web app manifest for "Add to Home Screen". Public pages (QR reporting, issue tracking, vendor portal) are mobile-first. `tests/ui/mobile-audit.mjs` checks every page for horizontal overflow at 390 px.

## Theming

Colours are CSS variables in `src/app/globals.css` (light and dark). The accent is green; to change it, edit `--primary`, `--ring` and `--accent*` under `:root` (and `.dark`), or set `data-accent="blue"` on `<html>` to use the alternate palette. Chart colours (`--chart-1…5`) are a validated colour-blind-safe categorical palette with separate dark-mode steps. Dark mode follows the device setting and can be changed per user in **Settings → My profile**.

## Project layout

```
src/
  app/
    (app)/            signed-in app: home, approvals, facility, expense, tasks, po, settings, scan
    (auth)/           login, signup, onboarding, invitations
    (public)/         QR reporting (/q/[token]), issue tracking (/report/status), vendor portal
    api/v1/[...path]  single entry point for the REST API
    docs/             API reference (Redoc)
  components/         ui primitives, app shell, shared building blocks (data table, forms, approvals, comments, charts)
  lib/
    api/              router, errors, pagination, OpenAPI, routes per module
    auth/             request context, permission evaluation, session data
    services/         business logic used by routes
    supabase/         clients and generated types
supabase/
  migrations/         schema, RLS, functions, triggers, cron
  functions/          Edge Functions + shared signature/template modules
  seed.sql            demo organisation
tests/                unit, db, e2e, ui
scripts/              db test reset, e2e stack, type generation
```
