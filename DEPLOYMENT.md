# Deployment guide

Two supported paths: **Vercel** (recommended — zero-ops, cron included) and
**Docker/self-hosted**. Both need a Supabase project for auth, the invoice storage bucket
and (on Vercel) the database. Work through [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)
before going live.

## Shared prerequisites

1. **Supabase project** — create one at [supabase.com](https://supabase.com):
   - **Project Settings → API**: copy the URL, anon key and (if you use Gmail/Outlook
     ingestion) the service-role key.
   - **Project Settings → Database**: copy the pooled (6543) and direct (5432) connection
     strings.
   - **Authentication → URL Configuration**: set the production site URL and add
     `https://<your-domain>/auth/callback` to the redirect allow list.
   - **Storage**: create the private `invoices` bucket and its RLS policy (SQL in the
     README, "Create the invoice storage bucket").
2. **Migrations** — apply the SQL migrations once against the direct connection:

   ```bash
   DATABASE_URL=<direct-url> npx prisma migrate deploy
   ```

3. **Secrets** — generate the ones the app signs/encrypts with:

   ```bash
   openssl rand -hex 32          # INTEGRATION_ENCRYPTION_KEY (if using integrations)
   openssl rand -base64 32       # CRON_SECRET
   npx web-push generate-vapid-keys   # if using push notifications
   ```

## Path A — Vercel

1. Push the repository to GitHub/GitLab and **Import Project** in Vercel.
2. Framework preset: Next.js (defaults are fine; the build runs `prisma generate` via
   the postinstall hook and then `next build`).
3. **Environment variables** — add everything you use from `.env.example` for the
   Production environment. Minimum viable set:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`,
   `DIRECT_URL`, `NEXT_PUBLIC_APP_URL` (your production URL), `CRON_SECRET`, and at least
   one AI key if you want the copilot.
4. **Cron** — `vercel.json` declares two **daily** jobs: `/api/cron/notifications` at
   00:00 UTC and `/api/cron/sync` at 01:00 UTC. Vercel sends
   `Authorization: Bearer $CRON_SECRET` automatically once the env var exists. Verify
   under **Project → Settings → Cron Jobs** after the first deploy.

   Daily is deliberate: it is the most the Hobby plan allows, and every notification
   window is at least a day wide (daily digest once per UTC day, weekly on Mondays,
   monthly on the 1st, alerts capped at one per day), so nothing is missed. What you
   give up is latency — a user who enables the daily digest at noon waits until the
   next 00:00 UTC. On Pro, switch to hourly by editing `vercel.json`:

   ```json
   { "crons": [
     { "path": "/api/cron/notifications", "schedule": "0 * * * *" },
     { "path": "/api/cron/sync",          "schedule": "30 * * * *" }
   ] }
   ```

   `/api/cron/sync` benefits more from that than notifications do: it re-syncs each
   connection when the provider's own interval has elapsed, which a daily trigger
   rounds up to a day. Both routes are idempotent, so a more frequent schedule never
   double-sends. To trigger a run now instead of waiting, see
   [Verifying notification email in production](#verifying-notification-email-in-production).
5. **Stripe** (optional) — point the webhook endpoint at
   `https://<your-domain>/api/webhooks/stripe`, subscribe to the events listed in the
   README, then set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the two price ids.
6. **Deploy**, then smoke-check:
   - `https://<your-domain>/api/health` returns `{"status":"ok","db":"up"}`.
   - Sign up, confirm the email, log in.
   - Import the sample CSV, check the dashboard renders.
7. **Domain** — add your custom domain in Vercel (TLS is automatic) and update
   `NEXT_PUBLIC_APP_URL`, the Supabase site URL/redirects, Stripe webhook URL and every
   OAuth redirect URI to match.

## Path B — Docker / self-hosted

1. Copy the env template and fill it in (Supabase values, `NEXT_PUBLIC_APP_URL` =
   your public URL, secrets from above):

   ```bash
   cp .env.example .env
   ```

   `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   must be set **before the first build**: Next.js inlines `NEXT_PUBLIC_*` values into
   the bundle at build time, so they cannot be injected at container start like the
   others. Compose passes them from `.env` as build args; changing one later needs
   `docker compose up -d --build`, not a restart. Get this wrong and the links inside
   notification emails point at the fallback origin instead of your domain.

2. Build and start the stack (app + Postgres 16):

   ```bash
   docker compose up -d --build
   ```

   Compose overrides `DATABASE_URL` to the bundled Postgres
   (`postgresql://ballast:ballast@db:5432/ballast`) — change the credentials in
   `docker-compose.yml` for anything internet-facing. To use Supabase's database instead,
   remove the override and the `db` service.

3. Apply migrations against the running database:

   ```bash
   docker compose exec app npx prisma migrate deploy
   ```

4. **Reverse proxy / TLS** — put nginx, Caddy or Traefik in front of port 3000 and
   terminate TLS there (HSTS is already emitted by the app). Example Caddyfile:

   ```
   ballast.example.com {
     reverse_proxy localhost:3000
   }
   ```

5. **Cron** — nothing schedules the cron endpoints for you. Add two system crontab
   entries (or a Kubernetes CronJob) hitting them hourly:

   ```cron
   0 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://ballast.example.com/api/cron/notifications
   30 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://ballast.example.com/api/cron/sync
   ```

6. **Health & restarts** — both services use `restart: unless-stopped`; point your
   monitor at `/api/health`. Postgres data persists in the `db-data` volume — back it up
   (e.g. `docker compose exec db pg_dump -U ballast ballast > backup.sql`).

   On this path `/api/health` reports `"storage": "not_applicable"`: the private
   `invoices` bucket lives in Supabase Storage, whose `storage.buckets` catalog does not
   exist in the bundled Postgres, so the database cannot be asked about it. That is a
   deployment shape, not a fault, and it does not degrade the status — check the bucket
   in the Supabase dashboard instead. `"storage": "down"` still means a real problem.

7. **Scaling out** — if you run more than one app container, set
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` so rate limits are shared, and make
   sure only one scheduler triggers the cron endpoints.

### Corporate network caveat

The Docker build and CI resolve packages from the public npm registry. Behind a corporate
proxy/mirror, copy an `.npmrc` (registry + `cafile`) into the build context before
`npm ci` and provide the proxy CA certificate to the build stage.

Prisma engine downloads from `binaries.prisma.sh` need no such treatment. `prisma generate`
runs through `scripts/prisma-generate.mjs`, which falls back to a placeholder engine binary
when the download is blocked and still generates a correct client — this project's
`prisma-client` generator emits TypeScript and the runtime talks to Postgres through the
`@prisma/adapter-pg` driver adapter, so no engine binary is ever executed. Optional
build-time variable:

| Variable | Default | Effect |
| --- | --- | --- |
| `PRISMA_ENGINE_STUB_FALLBACK` | `auto` | `auto` tries the real download and falls back if it fails; `always` skips the attempt (saves ~70s where the host is known to be blocked); `off` disables the fallback so the build fails instead. |

Only migrate/introspect commands (`db:push`, `db:migrate`) need a real engine; deployments
should use `npm run db:apply`, which applies migrations over a plain `pg` connection.

## Verifying notification email in production

Email cannot be verified locally. `sendEmail()` talks to `api.resend.com` over plain
`fetch`, so a dev machine without a Resend key or without outbound HTTPS reports
`not_configured` and skips the send — truthfully, but that proves nothing. Everything
below runs against a **deployed** instance.

### 1. Deploy, then set exactly these variables

Five variables decide whether a digest lands in an inbox. Everything else in
`.env.example` is optional for this purpose.

| Variable | Required for email? | Vercel | Docker |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | **Yes** — no key, no send | Project env var | `.env` (runtime) |
| `EMAIL_FROM` | **Yes** — `user@domain` or `Name <user@domain>` on a verified domain | Project env var | `.env` (runtime) |
| `CRON_SECRET` | **Yes** — both cron routes answer `503` without it, and Vercel Cron has nothing to authenticate with | Project env var | `.env` (runtime) |
| `DATABASE_URL` | **Yes** — the sweep reads memberships and preferences | Pooled Supabase URL (6543) | overridden by Compose |
| `NEXT_PUBLIC_APP_URL` | For usable mail — the links *inside* the email | Project env var, then redeploy | **build arg**, needs `--build` |

Both `RESEND_API_KEY` and `EMAIL_FROM` are required: with either missing the app reports
`not_configured` and skips rather than pretending. Set `EMAIL_FROM` to a real address —
leaving the `.env.example` placeholder in place makes the app believe the channel works
and turns every send into a 403.

Optional and unrelated to delivery: AI keys (a digest without one falls back to a
deterministic body), VAPID keys (push), `DIRECT_URL` (migrations only), Stripe,
integrations.

On Vercel, environment changes only reach **new** builds — redeploy after setting them.

### 2. Verify a sending domain in Resend

Until a domain is verified, Resend delivers only to the address your Resend account is
registered with and answers `403` for everyone else. Add the domain under
**Resend → Domains**, publish the DNS records, and point `EMAIL_FROM` at it. A dedicated
`send.<yourdomain>` subdomain is Resend's recommendation and keeps the records off your
apex.

### 3. Put one real account into a sendable state

A cron run only emails a user when **all** of these hold. Defaults are in brackets.

- The account is a member of a workspace and holds, there, the permission the
  notification needs: **`view_reports` for the digests and the low-cash alert** (both
  are built from balances, transactions and the forecast) and **`view_invoices` for
  invoice reminders**. Owners and admins hold both by default. The two scopes are
  resolved independently — the sweep picks one workspace per scope, which is the same
  workspace whenever the account may see both kinds there — so a member granted only
  `view_invoices` still gets reminders, and one granted only `view_reports` still gets
  digests. The sweep skips an account entirely only when **both** scopes are empty.
- `channel_email` is on `[true]`.
- The event is due:
  - daily digest — `daily_summary` on `[false, so this is the one to switch on]` and
    `last_daily_sent_at` NULL or from an earlier UTC day;
  - weekly `[true]` — only on a Monday, and >6 days since `last_weekly_sent_at`;
  - monthly `[true]` — only on the 1st, and >27 days since `last_monthly_sent_at`;
  - low cash `[true]` / invoice reminders `[true]` — only when the condition actually
    holds, at most once per UTC day.
- Mail goes to `profiles.email`, not the Supabase auth address, if those ever differ.

The daily digest is the only one you can make due on demand, so use it. Either flip
**Settings → Notifications → Daily summary** on in the app, or run this against the
production database:

```sql
-- Enable the daily digest + email channel for one account and clear today's
-- stamp, so the next cron run has something to send. Idempotent.
INSERT INTO notification_preferences (id, user_id, daily_summary, channel_email, created_at, updated_at)
SELECT gen_random_uuid()::text, p.id, true, true, now(), now()
  FROM profiles p
 WHERE p.email = 'you@example.com'
ON CONFLICT (user_id) DO UPDATE
   SET daily_summary = true,
       channel_email = true,
       last_daily_sent_at = NULL,
       updated_at = now();
```

Confirm the preconditions in one query — you want a row, `t`, `t`, a NULL stamp and a
role. `permissions` holds only the overrides on top of the role defaults, so NULL is
the normal case; for the daily digest it must not turn `view_reports` off (it cannot
for an OWNER, where overrides are ignored):

```sql
SELECT p.email, np.daily_summary, np.channel_email, np.last_daily_sent_at,
       wm.role, wm.permissions
  FROM profiles p
  JOIN notification_preferences np ON np.user_id = p.id
  LEFT JOIN workspace_members wm ON wm.user_id = p.id
 WHERE p.email = 'you@example.com';
```

### 4. Run the verification script

```powershell
$env:CRON_SECRET = "<the same value the deployment uses>"
npm run verify:email -- --url https://app.example.com
```

```bash
CRON_SECRET=... npm run verify:email -- --url https://app.example.com
```

It issues three GETs and nothing else: `/api/health` (does the server see both
variables?), `/api/health?probe=email` (does Resend accept the key, and is the
`EMAIL_FROM` domain verified?), then `/api/cron/notifications` with the bearer token.
It creates and deletes no user data; the cron itself only writes the notification rows
and last-sent stamps a scheduled run would, and is a no-op if re-run the same day.
`--dry-run` stops after the checks, before anything is sent. The token is read from
`CRON_SECRET` (or `--secret`) and never printed.

### 5. What success looks like

```
4/4  Delivery outcome
     ✓ SENT — Resend accepted 1 message(s)
       message id: re_5a1c…
```

The message id is the proof: look it up under **Resend → Emails** to see the delivery
event. `summariesSent: 1` alone is not proof — it counts events, not mail. The script
exits `0` only on `SENT`, and non-zero with a named fix otherwise.

The cron's own JSON carries a `stats.usersSkipped` alongside the counters (same value
in the `cron_notifications_completed` log line): accounts the run never started because
it hit its time budget — 255s of the 300s ceiling. Nothing was claimed for them, so
they stay due and the next run sends theirs late rather than never; a non-zero value
that keeps recurring means the sweep no longer fits one invocation. The script prints
it as a warning when it is non-zero.

### 6. The three failures you are most likely to hit

**`email.configured is false`.** The running server cannot see `RESEND_API_KEY` and/or
`EMAIL_FROM`. Almost always the variables were added but not redeployed — Vercel applies
env changes to new builds only. Set them for the *Production* environment and redeploy;
on Docker put them in `.env` and `docker compose up -d`.

**`DOMAIN_RESTRICTED` (Resend 403).** Not a bad key — the `EMAIL_FROM` domain is not
verified, so Resend refuses every recipient except your own account address. Finish
step 2. `GET /api/health?probe=email` with the bearer token says this in advance:
`fromDomainVerified: false`.

**`nothing was due, so no email was sent`.** The sweep ran clean and found no eligible
event: the daily digest is off by default, or it already went out earlier today, or the
account has no workspace it can view reports in (digests and low cash) and none it can
view invoices in (reminders). Redo step 3 — in particular
`last_daily_sent_at` must be NULL or from an earlier UTC day, because the cron claims
that slot *before* dispatching.

## Rollbacks

- **Vercel**: promote a previous deployment from the dashboard (instant).
- **Docker**: keep the previously built image tagged and `docker compose up -d` it.
- Migrations are forward-only SQL files; take a database backup before deploying a
  release that includes a new migration.
