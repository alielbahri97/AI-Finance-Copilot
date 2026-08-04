# Performance

This document describes the performance tuning done after upgrading Supabase
to the Pro plan (no project pausing, dedicated pooler, higher connection
limits), the environment knobs that control it, and the two dashboard-side
settings worth verifying.

## What was tuned

### Database connections (`src/lib/prisma.ts`)

The pg pool previously ran with `max: 1` to protect the free-tier pooler.
That serialized every `Promise.all` on the heavy pages — five "parallel"
queries ran one after another on a single connection. The pool now defaults
to **5 connections per serverless isolate** with a 30s idle timeout so warm
isolates keep their connections between navigations.

| Env var | Default | Meaning |
| --- | --- | --- |
| `DB_POOL_MAX` | `5` | pg connections per isolate. Set to `1` if you ever move back to a tiny pooler. |
| `DB_POOL_IDLE_TIMEOUT_MS` | `30000` | How long idle connections stay warm. |
| `DB_CONNECT_TIMEOUT_MS` | `5000` | Fail fast when the pooler is unreachable. |

Sizing note: Supabase Pro's transaction pooler allows hundreds of client
connections; with Vercel's per-region concurrency, `5 × active isolates`
stays comfortably below the limit for a small-team app. All the error
handling from the free-tier hardening (pool error logging, database-
unavailable fallback page, `db-errors` classification) is unchanged.

### Middleware (`src/middleware.ts`, `src/lib/supabase/middleware.ts`)

- The matcher now also skips `/api/webhooks/*` and `/api/cron/*` (they
  authenticate with signatures/secrets, not cookies) and `robots.txt` /
  `sitemap.xml`.
- Requests **without a Supabase session cookie** short-circuit before a
  Supabase client is even constructed: anonymous traffic costs ~0ms, and
  unauthenticated hits on protected pages redirect to `/login` instantly.
- The auth-server timeout dropped from 8s to 5s (a Pro project answers in
  well under a second; a slower answer means something is wrong and failing
  fast beats a hung request). Tunable via `SUPABASE_AUTH_TIMEOUT_MS`.
- The fail-fast behavior itself (redirect to login on transient auth
  failure instead of hitting Vercel's ~25s middleware limit) is kept as-is.

### Per-request deduplication (React `cache()`)

The dashboard layout and every page each resolved the user, profile and
entitlements independently. These are now request-memoized:

- `getUser()` — one Supabase auth round trip per request instead of one per
  layout/page/section (~50–150ms each).
- `getOrCreateProfile()` — one profile query per request. The
  default-category-rules backfill (which ran a `category.count`, a
  `category.findMany` and a **27-row INSERT on every page view**) now runs
  once per user per warm isolate; fresh isolates after a deploy re-run it,
  which is exactly when new default patterns can appear.
- `getEntitlements()` — one subscription + usage lookup per request, with
  the two lookups now running in parallel.
- `getDashboardData()` — shared between the dashboard's streamed stats and
  charts sections.

### Query-count reductions (from code inspection)

Counting DB queries + auth round trips for an existing user:

| Page | Before | After |
| --- | --- | --- |
| Dashboard | 2 auth calls + ~15 queries, serialized | 1 auth call + 8 queries, parallel |
| Reports | 2 auth calls + ~13 queries | 1 auth call + 9 queries |
| Forecast | 2 auth calls + ~13 queries (assumptions fetched twice) | 1 auth call + 8 queries |
| Transactions | 2 auth calls + ~10 queries | 1 auth call + 7 queries |

(The "before" figures include the 4-query profile/backfill block that every
page paid on top of the layout's own copy.)

### Streaming (Suspense)

The heavy pages (`/dashboard`, `/reports`, `/forecast`, `/transactions`,
`/invoices`, `/integrations`) now render a static shell (header, actions,
period selector) immediately and stream each data section behind its own
`Suspense` boundary with layout-matched skeletons. Sections resolve
independently, so one slow aggregate no longer blocks the whole page. The
route-level `loading.tsx` skeletons still cover the initial navigation.

### Caching

- The GoCardless institutions list is now cached server-side per country
  for 6 hours (it was already browser-cached for 1 hour). Opening the bank
  picker no longer costs a GoCardless token round trip per user.
- Per-user financial data is deliberately **not** cached beyond request
  scope — pages are `force-dynamic` and always reflect current data.

### Client-side navigation

- Link prefetching is on everywhere (no `prefetch={false}` in the app).
- The one internal `<a href>` (copilot quota banner) became a `next/link`
  navigation; the remaining `window.location` uses are OAuth/Stripe
  redirects that must be full-page.
- Heavy client bundles (Recharts charts, react-markdown) stay behind
  `next/dynamic` — nothing regressed.

## Verify in your dashboards

1. **Vercel function region ↔ Supabase region.** Every query pays the
   round trip between them. In Vercel → Project → Settings → Functions,
   set the region to the one closest to your Supabase project (shown in
   Supabase → Settings → General). Cross-region (e.g. `iad1` ↔
   `eu-central-1`) adds ~80–100ms to *every* query.
2. **Pooler connection strings after the upgrade.** The Pro upgrade keeps
   the same pooler hosts, but confirm in Supabase → Connect that
   `DATABASE_URL` still points at the transaction pooler (port 6543,
   `?pgbouncer=true`) and `DIRECT_URL` at port 5432, and that the values in
   Vercel match. `/api/health` reports `db: up/down` if you want a quick
   check after deploying.
