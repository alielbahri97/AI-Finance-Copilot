# First run

Everything on the machine is already prepared: dependencies are installed, a
`.env` exists with `FILL_ME` markers, and migrations can be applied without
Prisma's blocked schema engine. You only need a Supabase project and an AI
API key.

## Running at home vs corporate network

- **At home (recommended for the first run):** everything works against the
  public internet out of the box. `.npmrc` ships with the Artifactory
  registry line commented out, so `npm install` uses the public npm
  registry — no changes needed.
- **On the Optiver corporate network:** uncomment the `registry=` line in
  `.npmrc` (or set `$env:NPM_CONFIG_REGISTRY` to the Artifactory URL per
  shell) before running `npm install`. Note the runtime blockers below —
  installing works on-corp, but running the app against Supabase does not.

> **Corporate network caveat (read first):** from the corporate network the
> Supabase dashboard (`supabase.com`) is blocked by the proxy, direct
> outbound HTTPS (443) is proxy-only (Node.js does not use the system proxy,
> so server-side Supabase/OpenAI calls fail), and raw Postgres TCP
> (ports 5432/6543) is blocked entirely. **Do the first run from a
> non-corporate network** (home, hotspot) — or request firewall exceptions
> for `*.supabase.co:443`, `*.pooler.supabase.com:5432/6543`, and
> `api.openai.com:443`.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com), sign in, and click
   **New project**.
2. Pick any name (e.g. `finpilot`), choose a region near you, and set a
   **database password** — save it, you need it in step 2.
3. Wait ~2 minutes for provisioning to finish.

## 2. Fill in the 5 values in `.env`

Open `.env` in the repo root. Every `FILL_ME` must be replaced:

| `.env` variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard → **Project Settings → API** → *Project URL* (looks like `https://abcdefgh.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page → *anon / public* API key |
| `DATABASE_URL` | Dashboard top bar → **Connect** → *Transaction pooler* URI (port **6543**). Paste it, replace `[YOUR-PASSWORD]` with your database password, and keep `?pgbouncer=true` at the end |
| `DIRECT_URL` | Same dialog → *Session pooler* URI (port **5432**), password filled in, no query string |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) — or use Anthropic instead (set `ANTHROPIC_API_KEY` and `AI_PROVIDER="anthropic"`) |

## 3. Allow instant logins (recommended for testing)

In the dashboard: **Authentication → Sign In / Providers → Email** and turn
**Confirm email** off. (If you leave it on, signup sends a confirmation
email you must click before logging in; Supabase's built-in mailer is
rate-limited to a few per hour.)

## 4. Create the database schema

```powershell
npm run db:apply
```

This applies all 9 migrations in `prisma/migrations/` through a plain
Postgres connection (Prisma-compatible bookkeeping, idempotent — safe to
re-run). `npm run db:apply -- --dry-run` shows the plan without connecting.

## 5. Start the app and create your account

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), click **Get started**
/ **Sign up**, and register. You land on the dashboard (empty for now).

## 6. (Optional) Seed demo data

Grab your user id from the dashboard: **Authentication → Users** → copy the
UUID of the account you just created. Then:

```powershell
npm run db:seed -- <user-uuid> <your-email>
```

This creates the default categories plus ~6 months of demo transactions.

## 7. Import the sample bank statement

In the app go to **Import** (`/import`) and drag in
`sample-data/statement-sample.csv` (~40 realistic rows, May–July 2026:
salary, rent, subscriptions, groceries…). Confirm the detected column
mapping and commit the import.

Now the **Dashboard** charts populate, **Forecast** detects the recurring
salary/rent/subscription patterns, and the **Copilot** chat can answer
questions about the data (requires the AI key).

## Troubleshooting

- **`db:apply` hangs or times out** — Postgres TCP is blocked on your
  network (see the caveat above). Switch networks.
- **Signup says "fetch failed"** — the dev server cannot reach
  `*.supabase.co` (proxy-only network) or the Supabase URL/key is wrong.
- **Copilot errors** — `OPENAI_API_KEY` missing/invalid, or
  `api.openai.com` unreachable from the network.
- **`prisma generate` fails** (`binaries.prisma.sh` blocked) — only needed
  after schema changes; the stub-engine workaround is described in the
  README's corporate network section.
