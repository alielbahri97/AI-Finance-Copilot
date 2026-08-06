# Production launch checklist

Work through this before pointing real users at the app. Items marked *(optional)* only
apply if you enable that feature.

## Environment & secrets

- [ ] All required env vars set in the hosting platform: `NEXT_PUBLIC_SUPABASE_URL`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL` (pooled), `DIRECT_URL` (direct),
      `NEXT_PUBLIC_APP_URL` (the real production URL)
- [ ] `CRON_SECRET` set to a long random value (`openssl rand -base64 32`)
- [ ] At least one AI key (`GROQ_API_KEY` recommended, or `OPENAI_API_KEY` /
      `ANTHROPIC_API_KEY`); set `AI_PROVIDER="groq"` for the free default *(optional —
      copilot, extraction and digests degrade without it)*
- [ ] `INTEGRATION_ENCRYPTION_KEY` set (`openssl rand -hex 32`) *(optional — integrations)*
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set **server-side only** *(optional — Gmail/Outlook
      ingestion)*; confirm it appears nowhere in client code or `NEXT_PUBLIC_*`
- [ ] `UPSTASH_REDIS_REST_URL` + token set if running more than one instance
- [ ] No secrets committed to git (`.env` is git-ignored; check `git log` for accidents)

## Supabase

- [ ] Production site URL and `https://<domain>/auth/callback` configured under
      Authentication → URL Configuration. For this deployment:
      Site URL = `https://app.ballastmoney.com`, Redirect URLs include
      `https://app.ballastmoney.com/auth/callback` (and `/auth/confirm` if used).
      Keep the `https://ali-finpilot.vercel.app/**` entry — that is still the
      Vercel project's own hostname and preview builds sign in through it.
      Remove or demote `http://localhost:3000` as Site URL once production is live.
- [ ] Email confirmations enabled and email templates reviewed (sender name, links)
- [ ] Private `invoices` storage bucket created with the per-user RLS policy from the README
- [ ] RLS enabled on all tables in the `public` schema with no anon-role policies
      (Prisma connects with the postgres role; the anon key must not read app tables)
- [ ] All migrations applied: `npx prisma migrate deploy` (through
      `0017_workspace_editions`; note `0014_workspaces` migrates every existing user
      into a personal workspace and remaps all business data to workspace scope — take a
      backup first and apply it in one go). From a machine that cannot reach Postgres,
      paste `ops/migrations-bundle/apply-0016.sql` and then `apply-0017.sql` into the
      Supabase SQL editor instead; each records its own `_prisma_migrations` row, so
      `npm run db:apply` agrees afterwards.
- [ ] `0017_workspace_editions` applied: adds `workspaces.type`
      (`BUSINESS | PERSONAL`, default `BUSINESS`, so every existing workspace stays on
      the Business edition), the `PLUS`/`PREMIUM` plan tiers, `budgets.category_id` +
      `budgets.rollover`, and the `savings_goals` / `savings_contributions` tables.
      Additive only — nothing is dropped or narrowed, and an Instant Rollback to
      pre-0017 code runs fine on the new schema. Verify with result set 2 of the
      bundle: every existing workspace should read `BUSINESS`.
- [ ] `GROQ_VISION_MODEL` verified against https://console.groq.com/docs/vision (Groq
      rotates vision-capable models; a stale id makes image invoice extraction fall back
      or fail with a reason on the review page)
- [ ] Database backups: PITR or scheduled dumps enabled in the Supabase dashboard

## Stripe *(optional)*

- [ ] Live-mode products and monthly prices created; `STRIPE_PRICE_PRO` /
      `STRIPE_PRICE_BUSINESS` (Business edition, €19 / €49) and
      `STRIPE_PRICE_PERSONAL_PLUS` / `STRIPE_PRICE_PERSONAL_PREMIUM` (Personal
      edition, €4.99 / €8.99) match `src/lib/billing/plans.ts` pricing. A missing
      personal price id only disables upgrades for personal workspaces; the
      Business tiers keep working.
- [ ] Webhook endpoint `https://<domain>/api/webhooks/stripe` subscribed to
      `checkout.session.completed`, `customer.subscription.created/updated/deleted`,
      `invoice.paid`, `invoice.payment_failed`; `STRIPE_WEBHOOK_SECRET` set from it
- [ ] Billing Portal activated (plan switching + cancellation allowed)
- [ ] Test a full upgrade + cancel round-trip in test mode before switching to live keys

## Notifications *(optional)*

- [ ] Resend API key + verified sending domain; `EMAIL_FROM` uses that domain
      (unverified = Resend only delivers to your own account address, so team
      invites to anyone else fail with a 403 — they still work via their link)
- [ ] Confirmed against the deployment, not the dashboard: `GET /api/health` shows
      `email.configured: true`, and `?probe=email` with the `CRON_SECRET` bearer shows
      `fromDomainVerified: true`
- [ ] VAPID keys generated and set; push tested from Settings on a real device
- [ ] Cron running: Vercel Cron jobs visible (or self-hosted crontab installed) and a
      manual `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/notifications`
      returns `{"ok":true,...}`
- [ ] **Real delivery proven, not assumed**: `npm run verify:email -- --url https://<domain>`
      ends in `SENT` with a Resend message id. `summariesSent: 1` on its own is not
      proof — it counts events, not mail. Full procedure and the three usual failures:
      [DEPLOYMENT.md → Verifying notification email in production](DEPLOYMENT.md#verifying-notification-email-in-production)

## Integrations *(optional)*

- [ ] Each enabled provider's OAuth app registered with the **production** redirect URI
      `https://<domain>/api/integrations/<id>/callback`
- [ ] Plaid moved from sandbox to production credentials (`PLAID_ENV=production`)
- [ ] `/api/cron/sync` scheduled (daily in `vercel.json`; hourly is worth it here and
      needs a Pro plan — see DEPLOYMENT.md) and a manual "Sync now" works end to end

## Domain, security & infrastructure

- [ ] Custom domain with valid TLS; HTTP redirects to HTTPS
- [ ] `NEXT_PUBLIC_APP_URL`, Supabase URLs, Stripe webhook and OAuth redirect URIs all
      updated to the final domain
- [ ] Security headers verified in production responses (CSP, HSTS, X-Frame-Options,
      Referrer-Policy, Permissions-Policy) — e.g. `curl -I https://<domain>`
- [ ] Rate limiting verified: hammering an AI/export endpoint returns 429 with Retry-After
- [ ] Admin account provisioned: `UPDATE profiles SET is_admin = true WHERE email = '...'`
      — and only for the intended people

## Monitoring & operations

- [ ] Uptime monitor pointed at `GET /api/health`
- [ ] Log drain configured (Vercel Log Drain / container stdout shipper) — logs are JSON lines
- [ ] Sentry wired *(optional)* per the README "Monitoring & logging" section
- [ ] Database backup restore actually tested once
- [ ] Rollback path understood (previous Vercel deployment / previous image tag)

## Final verification

- [ ] `npm run lint` — clean
- [ ] `npm run typecheck` — clean
- [ ] `npm test` — all passing
- [ ] `npm run build` — succeeds
- [ ] Fresh-account walkthrough in production: sign up → confirm email → import CSV →
      dashboard/forecast/reports render → invoice upload → notification appears
