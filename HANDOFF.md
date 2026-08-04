# HANDOFF — project context for a new agent

> Written 2026-08-04 as a context transfer. If you are a new agent picking this
> project up with no prior history, read the "Start here" list, then the
> **Development environment constraints** section — that one is unusual and will
> waste hours if you skip it.

---

## Start here (the 10 things that matter most)

1. **What this is**: a production-deployed AI finance copilot for small
   businesses, live at <https://app.ballastmoney.com>. Next.js 15 + Supabase +
   Prisma. Built end to end over the previous conversation; it is not a toy.
2. **The app is still named "FinPilot" in the code and UI.** A rebrand to
   **Ballast** is decided and queued but not yet done. See
   [Pending work queue](#9-pending-work-queue--all-decisions-already-made).
3. **The user's machine is behind a corporate (Optiver) proxy** that blocks npm,
   Prisma engine downloads, Postgres ports, and the Supabase / Vercel / Resend
   dashboards and APIs. You must set two env vars in every shell or nothing
   builds. See [section 5](#5-development-environment-constraints-read-this-first).
4. **You cannot apply database migrations from this machine.** The established
   workaround is generating a paste-into-Supabase SQL bundle. See
   [section 6](#6-migration-workflow).
5. **You *can* reach production with the `WebFetch` tool** (different network
   path than the shell). `WebFetch https://app.ballastmoney.com/api/health` is
   the primary way to verify what is actually deployed.
6. **Every data query must be scoped by `workspaceId`** via
   `src/lib/workspace/context.ts`. The app is multi-tenant; cross-workspace
   leakage is the number one thing to never regress.
7. **Migrations are hand-written SQL** in `prisma/migrations/NNNN_name/migration.sql`
   (0001 → 0016 all applied to production). Never use `prisma migrate dev`.
8. **Forward-only deploys.** Vercel Instant Rollback is now unsafe — migration
   0014 dropped unique indexes the older code depends on.
9. **Before every push**: `npm test`, `npm run lint`, `npx tsc --noEmit`,
   `npm run build` must all pass. This has been held to on every commit so far.
10. **Deadline on the calendar**: Groq retires `llama-3.3-70b-versatile` on
    **2026-08-16**. Fix is a Vercel env change only — set
    `GROQ_MODEL=openai/gpt-oss-120b`. No code change, no redeploy needed.

---

## 1. What the product is

An AI-powered finance copilot. The user owns a restaurant and built this first
for their own business, then decided to sell it as a SaaS product to other small
businesses, with a lighter personal-finance edition planned for individuals.

### Features as built

| Area | What exists |
| --- | --- |
| **Auth** | Supabase email/password: login, signup with confirmation, forgot/reset password, session-refresh middleware, protected routes |
| **Dashboard** | Income/expense stat cards with month-over-month trends, cash-flow chart, category donut, cash-balance history, largest expenses, recent activity, invoice-attention banner, runway teaser |
| **CSV import** | Drag & drop, auto-detection of delimiter (`,` `;` tab `|`), encoding (UTF-8/UTF-16/Windows-1252), US vs EU number formats, date layouts, and column roles; mapping-preview step the user can correct; SHA-256 dedupe fingerprints; import batches with one-click undo |
| **Categories** | 16 seeded defaults per user, custom categories with colours, auto-categorization rules (substring → category, longest match wins) applied at import |
| **Transactions** | Debounced search, URL-driven filters (type, category, batch, date range, amount range), server-side pagination, inline category edit, multi-select bulk edit/delete |
| **AI copilot** | Streaming chat grounded in a real financial snapshot (12-month summaries, category spend, top counterparties, recurring patterns, trend forecast, z-score anomalies); multi-conversation history with auto-titles; data-driven suggested questions; markdown rendering |
| **Forecasting** | 30-day / 90-day / 12-month projections combining trend regression + recurring-payment scheduling + manual assumptions; cash runway, burn rate, recurring income/expenses, upcoming bills; AI "explain this forecast"; editable assumptions |
| **Invoices** | PDF/image/receipt upload to Supabase Storage; AI extraction (vendor, number, dates, currency, VAT, line items, totals) with vision-model routing and cross-provider fallback; per-field confidence highlighting; arithmetic validation; payable/receivable direction; paid/unpaid; reminders; transaction matching and linking |
| **Executive reports** | `/reports` with period selector (this month, last month, quarter, YTD, last 12 months, custom); KPIs (revenue, expenses, profit, margin, cash, AR, AP); monthly and year-over-year charts; category breakdown; top vendors/customers; AR/AP aging; PDF (pdf-lib), Excel (exceljs) and CSV export |
| **Notifications** | Daily/weekly/monthly AI digests, large-transaction alerts, low-cash warnings, invoice reminders; in-app notification centre with unread badge, email (Resend), web push (VAPID); per-type and per-channel settings; hourly Vercel cron with idempotent last-sent tracking |
| **Billing** | Stripe subscriptions — Free / Pro €19 / Business €49 / Enterprise; 14-day card-free Pro trial; usage records and feature gating enforced server-side; billing portal; referral programme; admin dashboard with KPIs and analytics events |
| **Integrations** | 11 providers: Plaid, Tink, GoCardless (banks); QuickBooks, Xero, Exact Online (accounting); Gmail, Outlook (invoice ingestion); Slack, Teams (alerts); Google Calendar (bill reminders). AES-256-GCM encrypted tokens, automatic sync via cron with backoff, icon-grid UI with per-provider setup guides |
| **Teams** | Multi-user workspaces; OWNER/ADMIN/MEMBER/VIEWER roles; 12 granular permissions with per-member overrides; email-bound single-use invitations with regenerate-link; workspace switcher; audit log; seat limits by plan |
| **Help agent** | Separate in-app support assistant answering "how do I…" questions from a knowledge base written against the real UI; keyword retrieval; streaming; context-aware (knows the user's plan and which integrations are configured); does not consume copilot quota |
| **Multi-bank** | Several bank connections per workspace, each with its own consent/sync/rate-limit budget; per-account balances; combined cash total with per-account breakdown; `includeInTotals` toggle |
| **Onboarding** | Wizard with business profile and industry benchmarks (added by the user directly) |
| **PWA** | Manifest, icons, service worker, install prompt, Windows packaging config (`WINDOWS_APP.md`) |

---

## 2. Tech stack and architecture

**Stack**: Next.js 15.5 (App Router, Turbopack) · React 19 · TypeScript ·
Tailwind CSS v4 · hand-rolled shadcn/ui components (Radix primitives) ·
Supabase (auth + Postgres + Storage) · Prisma 7 with the `pg` driver adapter ·
Zod v4 · React Hook Form · Recharts 3 · Vitest · Stripe · Resend · web-push ·
pdf-lib · exceljs · unpdf.

**AI is provider-abstracted** (`src/lib/ai/`): Groq (default), OpenAI, Anthropic
behind one `AiClient` interface supporting streaming and multimodal input.
Model ids are read per request from env, so a model can be swapped from the
Vercel dashboard with no redeploy.

### Folder layout

```
prisma/
  schema.prisma            # 42 models/enums, single source of truth
  migrations/0001…0016/    # hand-written SQL, all applied to production
  seed.ts
scripts/
  apply-migrations.ts      # `npm run db:apply` — pg-based migration runner
  smoke-test.mjs, feature-test-auth.mjs, lookup-user.ts
ops/migrations-bundle/     # paste-into-Supabase SQL bundles + runbook
src/
  middleware.ts            # session refresh + route protection
  app/
    (auth)/                # login, signup, forgot-password, reset-password
    (dashboard)/           # dashboard, transactions, categories, import,
                           # invoices, forecast, reports, copilot, help,
                           # integrations, team settings, billing, admin, profile
    (onboarding)/
    api/                   # 60 route handlers
    auth/                  # Supabase callback + confirm
  components/              # ui/ + one folder per feature area
  lib/
    workspace/{context,permissions}.ts   # ← AUTHORIZATION CORE
    ai/                    # provider registry, adapters, prompts, context, suggestions
    help/                  # knowledge base, retrieval, prompts
    finance/               # shared recurrence/forecast primitives
    integrations/          # registry, providers/*, gocardless-core, bank-import
    billing/{plans,entitlements}.ts
    csv/                   # detect, normalize, fingerprint
    reports/               # data builder + exporters
    notifications/         # dispatch, email, email-health, summaries, schedule
    invoices/              # extraction, extraction-core, ingest, storage
    currency/              # location detection + parsing
    db-errors.ts           # outage vs schema-drift classification
    logger.ts, prisma.ts, env.ts, rate-limit.ts, data.ts
tests/                     # 25 Vitest files, pure-logic coverage
```

### Key architectural rules

- **`src/lib/workspace/context.ts`** — `getWorkspaceContext()` authenticates the
  user, validates the `fp_workspace` cookie **against database membership on
  every request**, and returns `{ user, workspace, role, permissions }`.
  `requireWorkspace(...perms)` is the API guard (401/403). *Never* trust the
  cookie alone; *never* query business tables without a workspace scope.
- **`src/lib/workspace/permissions.ts`** — 12 permissions, role defaults,
  per-member overrides (owners are immune to overrides).
- **`src/lib/billing/entitlements.ts`** — `getEntitlements(workspaceId)` returns
  plan + limits + period usage. Gating is enforced server-side; UI state is
  cosmetic.
- **`src/lib/prisma.ts`** — pg pool (`DB_POOL_MAX`, default 5) + driver adapter,
  fails fast on missing `DATABASE_URL`. No Prisma query engine binary needed at
  runtime.
- **`src/lib/db-errors.ts`** — distinguishes *outage* (P1001/P1002/ECONNREFUSED,
  retryable) from *schema drift* (P2021/P2022/42P01/42703, means "run
  migrations"). Dashboard renders a degraded page instead of a 500.
- **React `cache()`** wraps `getUser`, `getOrCreateProfile`, `getEntitlements`,
  `getDashboardData` so layout and page share one round trip.
- **All heavy pages stream** — static shell + Suspense boundaries with
  skeletons from `components/dashboard/section-skeletons`.

---

## 3. Live infrastructure and accounts

| Thing | Value / notes |
| --- | --- |
| **GitHub** | <https://github.com/alielbahri97/AI-Finance-Copilot> — branch `master`. **Public**; the user was advised to consider making it private (Settings → General → Danger Zone) |
| **Vercel** | Project serves <https://app.ballastmoney.com> and <https://ali-finpilot.vercel.app>. Auto-deploys on push to master. Build region observed as `iad1` (US East) — see outstanding actions |
| **Domain** | `ballastmoney.com`, DNS hosted at **Cloudflare**. `CNAME app → 8e765e5353d44eda.vercel-dns-017.com`, **must be "DNS only" (grey cloud)** — proxying breaks Vercel cert issuance. Root domain has no record yet (deliberate: app on `app.`, root reserved for a future marketing site) |
| **Supabase** | **Pro** plan (paid, no pausing, dedicated pooler). Private Storage bucket `invoices`. Auth URL config: Site URL `https://app.ballastmoney.com`, redirect allow-list includes `https://app.ballastmoney.com/**`, `http://localhost:3000/**`, `https://ali-finpilot.vercel.app/**` |
| **Resend** | Sending subdomain `send.ballastmoney.com` **verified** (DKIM live). ⚠️ **MX and SPF TXT records were still missing** at handoff — deliverability gap, see outstanding actions |
| **AI keys** | Groq ✅ configured (default), OpenAI ✅ configured, Anthropic ❌ not configured |
| **Stripe** | Not yet configured in production (app runs on Free/trial and shows "billing not configured") |

---

## 4. Environment variables

All set in **Vercel → Settings → Environment Variables** (tick Production,
Preview, Development). Full annotated list lives in `.env.example`; that file is
the source of truth. Highlights:

| Variable | Purpose / gotcha |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `DATABASE_URL` | Transaction pooler, **port 6543**, must keep `?pgbouncer=true` |
| `DIRECT_URL` | Session pooler, port 5432 — used by migrations |
| `NEXT_PUBLIC_APP_URL` | `https://app.ballastmoney.com` — **a space typo here (`https://app ballastmoney.com`) broke a production build** with a cryptic `Failed to collect page data for /_not-found` / `ERR_INVALID_URL`. Whitespace in `NEXT_PUBLIC_*` values is a real failure mode |
| `AI_PROVIDER` | `groq` |
| `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_VISION_MODEL` | Text model `llama-3.3-70b-versatile` (**retires 2026-08-16**), vision `qwen/qwen3.6-27b`. Groq's default text model cannot read images — hence the separate vision model |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | `gpt-4o-mini`, natively multimodal |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Not set |
| `RESEND_API_KEY`, `EMAIL_FROM` | **Both required** or email is reported "not configured". From-address must sit on the verified domain: `noreply@send.ballastmoney.com` |
| `CRON_SECRET` | Bearer token for `/api/cron/notifications` and `/api/cron/sync` (Vercel Cron sends it automatically) |
| `INTEGRATION_ENCRYPTION_KEY` | 32-byte hex, AES-256-GCM for OAuth tokens. Required for any integration |
| `SUPABASE_SERVICE_ROLE_KEY` | Only for Gmail/Outlook background invoice ingestion |
| `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web push |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS` | Billing (optional) |
| `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_CONNECT_TIMEOUT_MS`, `SUPABASE_AUTH_TIMEOUT_MS` | Performance knobs, see `PERFORMANCE.md` |
| `PLAID_*`, `TINK_*`, `GOCARDLESS_*`, `QUICKBOOKS_*`, `XERO_*`, `EXACT_*`, `GOOGLE_*`, `MICROSOFT_*`, `SLACK_*` | Per-provider integration credentials, all optional |

> No secret values appear in this document by design. The user holds them in
> Vercel and the provider dashboards.

---

## 5. Development environment constraints (READ THIS FIRST)

The user works on an **Optiver corporate Windows machine behind a squid proxy**.
This is the single biggest source of surprise for a new agent.

### Shell setup required in *every* PowerShell session

```powershell
$env:NPM_CONFIG_REGISTRY = "https://artifactory.ams.optiver.com/artifactory/api/npm/npm/"
$env:PRISMA_SCHEMA_ENGINE_BINARY = "C:\Users\alielbahri\.prisma-stub-engine.exe"
```

- **npm**: `registry.npmjs.org` is blocked (ETIMEDOUT/403). The internal
  Artifactory mirror works. The repo's `.npmrc` has the registry line
  **commented out** so a home machine works out of the box; the user-level
  `~/.npmrc` carries the registry plus
  `cafile=C:\Users\alielbahri\optiver-ca-chain.pem` (Node does not trust the
  corporate CA otherwise).
- **Prisma engines**: `binaries.prisma.sh` is blocked and has no Artifactory
  mirror. `prisma generate` only checks the engine file *exists*, so an empty
  stub at `C:\Users\alielbahri\.prisma-stub-engine.exe` makes generate and
  builds work. Runtime queries never need it (pg driver adapter).

### What is blocked from this machine

| Target | Result |
| --- | --- |
| Postgres 5432 / 6543 | TCP blocked — **migrations and any DB access are impossible locally** |
| supabase.com, api.supabase.com | 403 via squid — dashboard unreachable |
| vercel.com, api.vercel.com | 403 via squid — no CLI, no API, no dashboard |
| api.resend.com | 403 via squid |
| Google Fonts | Unreachable at build → the app uses the system font stack (`next/font/google` deliberately not used) |

### What works

- **github.com** — `git push` works with the stored credential. Note the
  **repo-local git config** routes github.com auth to Git Credential Manager
  rather than the corporate `gh` CLI account (which is logged in as the Optiver
  user and returns nothing for `alielbahri97`). Do not "fix" that config.
- **DNS lookups** — `Resolve-DnsName` works and was used to verify the Cloudflare
  CNAME, Resend DKIM/MX/SPF records, and to catch a proxied (orange-cloud)
  record.
- **The `WebFetch` tool** — runs from a different network path and **does reach
  the live site**. This is how production is verified:
  `WebFetch https://app.ballastmoney.com/api/health`.
- Builds, lint, typecheck and the full Vitest suite all run fine locally.

### Known harmless noise

- Windows builds print `EINVAL` "failed to copy traced files" warnings from the
  standalone output. Pre-existing, unrelated to any change.
- A fresh Windows clone with `core.autocrlf=true` gets CRLF copies of migration
  files, whose sha256 differs from recorded checksums → `npm run db:apply`
  prints a harmless checksum-mismatch warning. No `.gitattributes` was added.

---

## 6. Migration workflow

Schema changes are **hand-written SQL** at
`prisma/migrations/NNNN_name/migration.sql`, paired with a `prisma/schema.prisma`
edit. `prisma migrate dev` is never used (no engine, no DB access).

`npm run db:apply` (`scripts/apply-migrations.ts`) is the normal runner: it
connects with `DIRECT_URL` over plain `pg`, creates `_prisma_migrations` if
absent, applies each pending migration in its own transaction, and records
bookkeeping compatible with Prisma (`checksum` = sha256 hex of the raw file
content read as utf8).

**But the user cannot run it from the corporate machine.** The established
process is:

1. Write the migration SQL as usual.
2. Generate a **paste-into-Supabase bundle** into `ops/migrations-bundle/`:
   transaction-wrapped, **re-runnable and idempotent**, skipping migrations
   already recorded, with correct `_prisma_migrations` bookkeeping rows and
   read-only verification `SELECT`s at the end.
3. Verify it statically (the previous bundles were parsed with `libpg-query` and
   diffed against a schema model replayed from the migration history).
4. Commit it, then have the user open the file on GitHub, **Copy raw contents**,
   and run it in **Supabase → SQL Editor** after taking a backup snapshot.
5. Confirm with `WebFetch https://app.ballastmoney.com/api/health` →
   `"schema":"ok"`.

Existing bundles: `ops/migrations-bundle/apply-pending-migrations.sql`
(0013–0015, includes baselining 0001–0012) and `apply-0016.sql`, plus a runbook
`README.md`.

### Traps discovered the hard way

- **0014's backfills have no `WHERE` clause** (`SET workspace_id = 'ws-' || user_id`).
  Re-running the raw file after data had been shared would silently pull every
  row back to its creator's personal workspace. Bundles add
  `WHERE workspace_id IS NULL`.
- **Migrations are not re-runnable as written** — bare `CREATE TYPE`,
  `ADD CONSTRAINT`, `ADD COLUMN`, `CREATE INDEX`. A half-finished manual run
  would leave the user stuck; bundles converge instead of failing.
- **`ALTER TYPE … ADD VALUE`** is fine inside a transaction on PG 12+ *provided
  the new label is not used before commit*. Check this whenever an enum grows.
- **Supabase's SQL editor warns "potentially destructive"** — expected, because
  the workspace migrations drop and recreate indexes/constraints. No `DROP TABLE`,
  `TRUNCATE`, or business-table `DELETE` exists in any bundle.
- **Rollback is now unsafe.** 0014 dropped `usage_records_user_id_period_key`,
  `integration_connections_user_id_provider_key` and `subscriptions_user_id_key`,
  which older code's upserts depend on. **Forward-only** — never use Vercel
  Instant Rollback to a pre-0014 deployment.
- **Deploy/migration ordering**: pushing code auto-deploys before the migration
  is applied, which briefly leaves the schema behind. Since `de804d9` this
  degrades gracefully (a "database is mid-update" page plus a diagnostic
  `/api/health`) instead of a blank 500, but plan to apply migrations promptly
  after a schema-changing push.

Applied migrations: `0001_init`, `0002_conversations`, `0003_assumptions`,
`0004_invoices`, `0005_invoice_direction`, `0006_notifications`, `0007_saas`,
`0008_integrations`, `0009_performance_indexes`, `0010_ai_provider_groq`,
`0011_business_profile`, `0012_default_ai_provider_groq`, `0013_help_messages`,
`0014_workspaces`, `0015_extraction_telemetry`, `0016_multi_bank_connections`.

---

## 7. Current state — what has been built

Commit history (most recent first), each verified green before pushing:

| Commit | Delivered |
| --- | --- |
| `9137717` | `/api/health` reports email configuration (diagnostic for the current email issue) |
| `db0a502` | Rollback warning after 0016 |
| `f3c7833` | Paste-into-Supabase bundle for 0016 |
| `62a4cfd` | **Multi-bank**: several connections per workspace, `BankAccount` model, combined cash view, per-account `includeInTotals` |
| `aa263b8` | **Invite delivery honesty**: link-first UI, real email status (sent / not configured / failed), regenerate-link, Resend domain-restriction detection |
| `f929c09` | **Help agent fix** — it passed a user id where a workspace id was expected, hitting an FK violation and 500ing before streaming. Also added a provider registry with per-request model ids and error classification |
| `de804d9` | **Schema-drift resilience** — P2021/P2022 classified, degraded page instead of 500, `/api/health` names missing tables/columns and pending migrations, public pages made drift-proof, service-worker cache no longer pins error pages |
| `05e1970` | **Invoice extraction hardening** — root cause was Groq receiving images on a text-only model; added vision-model routing with cross-provider fallback, tolerant JSON parsing, scanned-PDF image extraction, per-field confidence, arithmetic validation, telemetry (0015) |
| `69be86e`, `4319c83` | **Multi-user workspaces** — schema + 0014, authorization core, full workspace scoping of every route and page, team UI, invitations, switcher, audit log |
| `4dd3ff0` | **Supabase Pro performance pass** — found `pg` pool `max: 1` serializing every "parallel" query; also request-level dedupe with React `cache()`, removed a 27-row INSERT that ran on every page view, streaming with Suspense on six heavy pages, cached GoCardless institution list |
| `b34b849` | **Help agent** — knowledge base, retrieval, streaming route, panel + `/help`, `HelpMessage` (0013) |
| `8ee31ab` | **Integrations redesign** — icon-first tile grid, click-through detail sheets with per-provider "what it does / your data / setup steps", admin env-var hints, plan-gated with locked tiles |
| `f216878` | **GoCardless overhaul** — end-user agreements and consent expiry, rate-limit handling with per-account backoff, all requisition statuses, balance snapshots, searchable bank picker, first-sync progress |
| `dc491e2` | Test-suite fix for DB-less machines |
| earlier | Production audit (security headers, rate limiting, indexes, a11y, SEO, logger, health, Vitest, CI, Docker, docs), integrations framework, Stripe billing, notifications, reports, invoices, forecasting, copilot, transactions, base app |

Plus the user's own commits made from their home machine: onboarding wizard with
industry benchmarks, Groq + OpenAI-compatible adapter (Groq made default),
currency detection/parsing, PWA and Windows packaging, DB-resilience hardening,
report-issue button.

**Scale**: 42 Prisma models/enums · 60 API route handlers · 25 Vitest files ·
16 migrations. The last full verification reported 269 passing tests before the
final two agents added `email-delivery`, `email-health`, `ai-config`,
`multi-connection` and related specs — run `npm test` for the current number.

**Docs in the repo**: `README.md`, `FIRST_RUN.md`, `DEPLOYMENT.md`,
`PRODUCTION_CHECKLIST.md`, `PERFORMANCE.md`, `WINDOWS_APP.md`,
`ops/migrations-bundle/README.md`.

---

## 8. Outstanding actions for the USER (not code)

1. **Email delivery still reports "not configured"** in production. The user
   confirms `RESEND_API_KEY` is saved; the likely gaps are a missing
   `EMAIL_FROM`, environments not ticked for Production, or no redeploy after
   saving. `9137717` added an `email` section to `/api/health` to settle it —
   fetch the endpoint and read `apiKeyPresent`, `fromPresent`, `fromDomain`,
   `configured`.
2. **Add the missing Resend DNS records** in Cloudflare (grey cloud / DNS only):
   `MX send → feedback-smtp.<region>.amazonses.com` priority 10, and
   `TXT send → v=spf1 include:amazonses.com ~all`. DKIM is already live.
   Optionally `TXT _dmarc → v=DMARC1; p=none; rua=mailto:…`.
3. **Rotate the Resend API key** — it was pasted in plain text in chat.
4. **Set the Vercel function region** to match the Supabase region (build log
   showed `iad1`/US East; if the database is in the EU this costs ~80–100 ms per
   query). Settings → Functions → Region.
5. **Consider making the GitHub repo private.**
6. **Before 2026-08-16**: set `GROQ_MODEL=openai/gpt-oss-120b` in Vercel. Model
   ids are read per request, so no redeploy is required.
7. **Trademark check on "Ballast"** in software classes 9/42 before serious
   marketing spend — several wealth-advisory firms use the name (services, not
   software, so coexistence is likely).
8. Optional: verify a Stripe account and set the Stripe env vars when ready to
   charge; add `send.ballastmoney.com` warm-up before high email volume.

---

## 9. Pending work queue — all decisions already made

Do not re-ask the user these; they have been decided.

### 1. Ballast rebrand *(next up)*

- Name: **Ballast**. Domain `ballastmoney.com`.
- Scope: **name/text + a new keel-inspired logo mark and regenerated app icons**,
  keeping the existing colour scheme (the user chose this over a full visual
  refresh).
- Tagline: the user picked *"Your AI finance copilot"*, but that is **verbatim
  the headline of competitor `finpilotsai.com`** — the reason for leaving the
  FinPilot name in the first place. The proposed safe variant is
  **"Your AI copilot for business finances"**; use it unless the user objects.
- Must sweep: UI strings, page metadata/titles, landing page, email templates and
  sender name, **AI prompts** (both copilot and help agent introduce themselves
  by name), PWA manifest and icons, Windows packaging config, all docs, service
  worker cache names, test fixtures. Grep for `finpilot` case-insensitively.

### 2. Export everywhere

Add exports to: transactions (**respecting active filters**), invoices (optional
line items), forecast (Excel/CSV + PDF with chart and assumptions), a dashboard
PDF snapshot, bank balances, audit log CSV, and a **full data export ZIP**
(JSON + CSVs) for GDPR portability.

**Gating decided**: CSV free on every plan · Excel and PDF on paid plans ·
full data export always free (portability should not be paywalled).

### 3. Internationalization

Languages: **English, Dutch, German, French, Spanish, Turkish**. Arabic was
explicitly **dropped**, so no RTL work is needed.

Includes: language picker in settings + browser auto-detection on first visit,
locale-aware dates/numbers/currency, localized email templates, and the AI
instructed to answer in the user's language. Machine translation is acceptable;
the user has been told to get a native speaker to review financial terminology
per language before marketing in it.

Sequenced **after** the rebrand and exports so those strings are translated in
the same pass.

### 4. Login improvements

- **Remember-username** checkbox (stores the email locally, never the password).
- **Passkeys / WebAuthn** for Face ID and fingerprint sign-in, with password
  fallback always available. **SMS/phone OTP was explicitly declined** (per-message
  cost, SIM-swap risk).
- **Validate `NEXT_PUBLIC_*` env values** with clear startup errors. A stray
  space caused both a cryptic `Failed to execute 'fetch' on 'Window': Invalid
  value` at login and a `/_not-found` build failure — neither named the variable.

### 5. Business / Personal dual edition *(largest item)*

- Edition choice **before/at signup** ("For my business" / "For myself") driving
  a workspace type. Existing accounts stay Business. Users can hold both via the
  existing workspace switcher.
- **Personal keeps**: bank connections, import/categorization, AI chat,
  forecasting, alerts and digests, reports/exports.
  **Personal adds**: budgets per category with progress, savings goals,
  recurring-subscription detection, personal-flavoured AI prompts ("Can I afford
  this?" rather than "Can I hire?").
  **Personal hides**: invoices/VAT, AR/AP, vendors and customers, team sharing.
- Branding: **Ballast Business** / **Ballast Personal** under one domain.
- **Proposed personal pricing — not yet confirmed by the user**: Free €0
  (1 bank, 50 AI messages) · Plus €4.99/mo (unlimited banks, 500 AI messages,
  budgets, goals, exports) · Premium €8.99/mo (unlimited AI, assumptions,
  everything). Business tiers unchanged at €19/€49.

### Smaller undecided item

The user missed the floating **"Report issue"** button on dashboard pages after
their own commit `fcf1f08` removed it. It now lives in the sidebar footer, the
avatar menu, and the help panel footer, while the bottom-right FAB is the help
button. Merging them into a **two-action FAB** was offered and is undecided.

---

## 10. Working conventions to keep

- **Hand-written migrations only**, next number in sequence, never edit an
  applied one.
- **Every data query scoped by `workspaceId`** through the workspace context
  helper. Never trust the `fp_workspace` cookie without a membership check.
- **Zod validation on every API route**; ownership/permission checks server-side;
  the shared `apiError()` shape and structured logger (`src/lib/logger.ts`) for
  failures.
- **No TODO/FIXME comments** anywhere; **no `any`** in `src`.
- **Tests for pure logic** in `tests/*.test.ts` — extract logic out of routes
  into testable modules (the pattern used by `extraction-core`, `gocardless-core`,
  `csv/fingerprint`, `notifications/schedule`).
- **Before every push**: `npm test`, `npm run lint`, `npx tsc --noEmit`,
  `npm run build` — all green. Then commit and push to `origin master`.
- **Commit messages**: imperative mood, explain the *why*, one line summarising
  the change (e.g. *"Fix the help agent: scope its context lookup to the
  workspace, not the user"*).
- **Graceful degradation is a product requirement**: unconfigured providers show
  setup guidance rather than errors; failures name the specific cause and the
  env var to set.

---

## 11. How to verify production

```
WebFetch https://app.ballastmoney.com/api/health
```

Returns `status`, `db`, `storage`, `schema` (with `missingTables`,
`missingColumns`, `pendingMigrations` when drifted), the `ai` provider config
with the model ids actually in use, and now an `email` section
(`configured`, `apiKeyPresent`, `fromPresent`, `fromValid`, `fromDomain` —
never secret values).

- `?probe=ai` with the `CRON_SECRET` bearer token → token-free provider
  models-list check.
- `?probe=email` (same auth) → checks the Resend key authenticates and lists
  verified domains, so a from-domain mismatch is visible. `?probe=all` does both.
  Without the bearer token the response says the probe was unauthorized rather
  than silently skipping it.
- Pages worth spot-checking: `/` (landing) and `/login` render without a session.
- **After every deploy, hard-reload** (Ctrl+Shift+R) — the service worker caches
  the app shell, and a stale error page can survive a fix.

A healthy response looks like:

```json
{"status":"ok","db":"up","storage":"up","schema":"ok","ai":{...},"latencyMs":760}
```
