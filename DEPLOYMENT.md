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
4. **Cron** — `vercel.json` already declares the two hourly jobs
   (`/api/cron/notifications` at :00, `/api/cron/sync` at :30). Vercel sends
   `Authorization: Bearer $CRON_SECRET` automatically once the env var exists. Verify
   under **Project → Settings → Cron Jobs** after the first deploy.
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

7. **Scaling out** — if you run more than one app container, set
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` so rate limits are shared, and make
   sure only one scheduler triggers the cron endpoints.

### Corporate network caveat

The Docker build and CI resolve packages from the public npm registry and Prisma engines
from `binaries.prisma.sh`. Behind a corporate proxy/mirror, copy an `.npmrc` (registry +
`cafile`) into the build context before `npm ci` and provide the proxy CA certificate to
the build stage.

## Rollbacks

- **Vercel**: promote a previous deployment from the dashboard (instant).
- **Docker**: keep the previously built image tagged and `docker compose up -d` it.
- Migrations are forward-only SQL files; take a database backup before deploying a
  release that includes a new migration.
