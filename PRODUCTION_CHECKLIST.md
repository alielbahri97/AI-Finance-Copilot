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
      Authentication → URL Configuration. For ali-finpilot:
      Site URL = `https://ali-finpilot.vercel.app`, Redirect URLs include
      `https://ali-finpilot.vercel.app/auth/callback` (and `/auth/confirm` if used).
      Remove or demote `http://localhost:3000` as Site URL once production is live.
- [ ] Email confirmations enabled and email templates reviewed (sender name, links)
- [ ] Private `invoices` storage bucket created with the per-user RLS policy from the README
- [ ] RLS enabled on all tables in the `public` schema with no anon-role policies
      (Prisma connects with the postgres role; the anon key must not read app tables)
- [ ] All migrations applied: `npx prisma migrate deploy` (through `0014_workspaces` —
      this one migrates every existing user into a personal workspace and remaps all
      business data to workspace scope; take a backup first and apply it in one go)
- [ ] Database backups: PITR or scheduled dumps enabled in the Supabase dashboard

## Stripe *(optional)*

- [ ] Live-mode products and monthly prices created; `STRIPE_PRICE_PRO` /
      `STRIPE_PRICE_BUSINESS` match `src/lib/billing/plans.ts` pricing
- [ ] Webhook endpoint `https://<domain>/api/webhooks/stripe` subscribed to
      `checkout.session.completed`, `customer.subscription.created/updated/deleted`,
      `invoice.paid`, `invoice.payment_failed`; `STRIPE_WEBHOOK_SECRET` set from it
- [ ] Billing Portal activated (plan switching + cancellation allowed)
- [ ] Test a full upgrade + cancel round-trip in test mode before switching to live keys

## Notifications *(optional)*

- [ ] Resend API key + verified sending domain; `EMAIL_FROM` uses that domain
- [ ] VAPID keys generated and set; push tested from Settings on a real device
- [ ] Cron running: Vercel Cron jobs visible (or self-hosted crontab installed) and a
      manual `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/notifications`
      returns `{"ok":true,...}`

## Integrations *(optional)*

- [ ] Each enabled provider's OAuth app registered with the **production** redirect URI
      `https://<domain>/api/integrations/<id>/callback`
- [ ] Plaid moved from sandbox to production credentials (`PLAID_ENV=production`)
- [ ] `/api/cron/sync` scheduled (hourly) and a manual "Sync now" works end to end

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
