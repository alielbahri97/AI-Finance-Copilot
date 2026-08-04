# How to bring production back up

Applying migrations 0013, 0014 and 0015 from any browser (including a phone).

## What is wrong

The new code is deployed on Vercel, but the database is still on the old schema.
The app is asking for tables and columns that do not exist yet (`help_messages`,
`workspaces`, `workspace_id` everywhere, the invoice `extraction_*` columns), so
requests fail.

Three migrations are unapplied:

| Migration | What it does |
| --- | --- |
| `0013_help_messages` | Adds the `help_messages` table |
| `0014_workspaces` | The big one: adds workspaces and moves every business table from per-user to per-workspace scope |
| `0015_extraction_telemetry` | Adds 6 nullable columns to `invoices` |

## What the fix is

One file — [`apply-pending-migrations.sql`](./apply-pending-migrations.sql),
sitting next to this README — contains all three migrations plus the bookkeeping
rows Prisma needs. You paste it into the Supabase SQL Editor and press **Run**.
That is the whole job. You do not need your home machine, a terminal, or Node.

File to paste:

```text
ops/migrations-bundle/apply-pending-migrations.sql
```

---

## Step A. Take a backup first

In the Supabase dashboard: **Database → Backups**

Take (or confirm) a snapshot before you run anything. On paid plans use
**Create backup** or note the latest Point-in-Time Recovery timestamp; on the
free plan, note the most recent daily backup time.

You almost certainly will not need it — the script is wrapped in a single
transaction, so a failure changes nothing — but 0014 rewrites indexes on every
business table, and a backup is thirty seconds of insurance.

---

## Step B. Open the SQL editor

Supabase dashboard → **SQL Editor** → **New query**

Make sure you are in the **production** project. Check the project name in the
top-left switcher before you paste anything.

---

## Step C. Paste and run

1. Open `apply-pending-migrations.sql` and select **all** of it (Ctrl+A /
   Cmd+A). Do not paste only part of it — it has to run as one unit or the
   transaction logic does not work.
2. Paste into the empty query box.
3. Press **Run** (or Ctrl+Enter / Cmd+Enter).
4. Supabase may pop up a warning that the query looks destructive and ask you to
   confirm. That is expected — the script does contain `ALTER TABLE` and
   `DROP INDEX` statements. Confirm it.
5. It should finish in a few seconds to a minute or so, depending on how much
   data you have. Do not close the tab while it runs.

---

## Step D. How to tell it worked

The end of the script runs three read-only checks. The Supabase editor shows the
result of the last one, which is a summary table. **Read that one.**

It has 15 rows and the last column says `result`. You want every single row to
say:

```text
OK
```

Anything that says `*** LOOK AT THIS ***` needs attention — send me that row.
The checks confirm, among other things:

- 0013, 0014 and 0015 are now recorded in `_prisma_migrations`
- Their recorded checksums match the files in the repo
- The `workspaces`, `workspace_members`, `workspace_invitations`, `audit_logs`
  and `help_messages` tables exist
- All 14 `workspace_id` columns exist and are `NOT NULL`
- Every profile has a personal workspace and is an `OWNER` of it
- `invoices` has all 6 `extraction_*` columns
- No transaction rows point at a workspace that does not exist

If you scroll up in the results panel you can also see the full migration
history (expect 15 rows, 0001 through 0015, each with a `finished_at` timestamp
and an empty `rolled_back_at`).

Then just load the site. It should work.

---

## Step E. If it errors

**Nothing was changed.** The whole script runs inside one transaction
(`BEGIN … COMMIT`), so if any statement fails, Postgres throws the entire thing
away. Your database is exactly as it was. You are not half-migrated and you have
not made anything worse.

What to do:

1. Copy the **full** error message, including any line number, `DETAIL:` and
   `HINT:` lines.
2. Send it to me. I will fix the script and send you a new one.
3. Do not start hand-editing the SQL to get past the error — in 0014 the order
   of operations matters, and a partial fix can leave the data wrong in ways
   that are hard to see.

Two errors have known quick answers:

- **`canceling statement due to statement timeout`** or
  **`canceling statement due to lock timeout`**

  Something else is holding locks on the tables, or you have more data than
  expected. Safe to simply press **Run** again. If it keeps happening, pause the
  Vercel deployment (or scale it to zero) so nothing is talking to the database,
  then run it again.

- **`ALTER TYPE ... ADD cannot run inside a transaction block`**

  This should not happen on Supabase (their Postgres is new enough to allow it),
  but if it does: open a separate **New query**, run just this one line on its
  own,

  ```sql
  ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORKSPACE';
  ```

  and then run the full `apply-pending-migrations.sql` again from the top. The
  script is safe to re-run.

It is safe to run the script twice. Every statement is written so that
re-running it is a no-op, and the parts of 0014 that create rows are skipped
once 0014 is recorded as applied.

---

## Step F. The other route, from your home machine

If you would rather use the repo's own tooling and you are on a machine that can
reach the database (port 5432/6543 open, `.env` filled in):

```bash
cd ai-finance-copilot
git pull
npm install
npm run db:apply
```

That runs `scripts/apply-migrations.ts`, which does exactly what this SQL file
does. You want to see:

```text
>  0013_help_messages: applying... done
>  0014_workspaces: applying... done
>  0015_extraction_telemetry: applying... done
Applied 3 migration(s). Database is up to date.
```

Use **one** route or the other, not both at once. If you already ran the SQL
file, `npm run db:apply` will simply report:

```text
=  0013_help_messages: already applied, skipping
=  0014_workspaces: already applied, skipping
=  0015_extraction_telemetry: already applied, skipping
```

That is the point of the bookkeeping rows the SQL file writes: it records the
same SHA-256 checksums that `db:apply` computes, so it agrees the work is done
and does not try to redo it or complain that anything drifted.

You can also check without changing anything:

```bash
npm run db:apply -- --dry-run
```

**Windows caveat.** The migration files are stored with LF line endings, and the
checksums below are the LF checksums. Git on Windows with `core.autocrlf=true`
rewrites text files to CRLF on checkout, which changes their bytes and therefore
their SHA-256. If you run `db:apply` from a fresh Windows clone after applying
this bundle, it may print a "checksum mismatch" warning for 0013/0014/0015. That
warning is cosmetic — it does not re-run or fail anything. To avoid it, clone
with `git -c core.autocrlf=false clone …` or run the route from WSL/macOS/Linux.

---

## Step G. Do you need to redeploy?

No. The deployed Vercel app should recover on its own, within seconds to a
minute, with no redeploy. The code was already correct — it was just querying
tables that did not exist yet. Once they exist, the queries succeed.

Two caveats:

- Serverless functions hold pooled connections with a cached view of the schema.
  If you see stale errors for a minute after the migration, give it a moment and
  retry before worrying.
- If errors persist past a couple of minutes, a redeploy is harmless and forces
  every function instance to start fresh: Vercel → Deployments → latest →
  **Redeploy**. It is a safe thing to try, just not usually necessary.

Clear your browser cache and **hard-reload** the page too, so you are not
looking at a cached error response. The app registers a service worker, which
will keep serving the old cached shell until you force a hard reload
(Ctrl+Shift+R / Cmd+Shift+R, or on mobile: close all tabs for the site and
reopen, or clear site data).

---

## Step H. Ordering constraint: rollback before you migrate, never after

**Do not use Vercel Instant Rollback to a pre-0014 deployment after you have
applied 0014.**

Migration 0014 drops three unique indexes that the older code's `upsert` calls
depend on:

- `usage_records_user_id_period_key`
- `integration_connections_user_id_provider_key`
- `subscriptions_user_id_key`

The pre-0014 code performs upserts against those unique constraints. Once 0014
has replaced them with their workspace-scoped equivalents, that older code can
no longer resolve its conflict targets and those writes fail — so rolling the
deployment back does *not* restore a working app, it produces a differently
broken one.

The ordering rule, therefore:

| Situation | Instant Rollback safe? |
| --- | --- |
| Before applying 0014 | Yes — the old schema and old code still match |
| After applying 0014 | **No** — the old code needs indexes that 0014 removed |

If you have already migrated and something is wrong with the new deployment,
roll *forward* (fix and redeploy) rather than back. Going back to a pre-0014
deployment would additionally require restoring the pre-migration database
backup, which loses everything written since.

---

## Reference

### Checksums recorded

SHA-256, hex, of the exact `migration.sql` file bytes — the same thing
`scripts/apply-migrations.ts` computes:

| Migration | sha256 |
| --- | --- |
| `0013_help_messages` | `c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d` |
| `0014_workspaces` | `0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e` |
| `0015_extraction_telemetry` | `c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f` |

**Important:** these checksums describe the migration files as they were when
this bundle was generated. They were re-verified against the migration files as
committed alongside this README and they match. If any of those three files
changes afterwards, `npm run db:apply` will print a "checksum mismatch"
*warning* (it will not re-run the migration and it will not fail). If you see
that warning, tell me and I will regenerate the bundle.

### What the script does, in order

1. `BEGIN`, and raise the statement timeout for this transaction.
2. Create the `_prisma_migrations` bookkeeping table if it is missing, using the
   exact same DDL the repo's apply script uses.
3. If that table was empty (meaning the schema was built with `prisma db push`
   and has no migration history), record 0001–0012 as already applied. Without
   this, the next `npm run db:apply` would try to re-run `0001_init` and fail
   with "type TransactionType already exists".
4. Delete any leftover failed/rolled-back rows for 0013/0014/0015, which would
   otherwise make `db:apply` refuse to run.
5. Apply 0013, then 0014, then 0015, in that order.
6. Insert one bookkeeping row per migration, with the checksums above.
7. `COMMIT`.
8. Run the three read-only verification queries.

### Why the SQL is not a literal copy of the migration files

Every statement was made safe to re-run — `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`DROP CONSTRAINT IF EXISTS` before each `ADD CONSTRAINT`,
`ON CONFLICT DO NOTHING` on the two row-seeding inserts, and
`WHERE workspace_id IS NULL` on the backfill updates. On a clean first run these
guards change nothing: the tables do not exist yet, the columns were just added
so every row is `NULL`, and no constraints are present to drop.

This was verified mechanically, not by eye: both the original three migration
files and this bundle were replayed through the real PostgreSQL 17 parser and the
resulting schemas compared. They are identical — same 26 tables, same columns,
same 16 enums, same 121 indexes and constraints (including foreign-key
`ON DELETE` behaviour), same 185 `NOT NULL` columns.

### One thing to know about 0014

0014 is the risky one, and the reason the transaction matters. It adds a
`workspace_id` column to 11 existing tables, backfills it from `user_id`, marks
it `NOT NULL`, adds a foreign key, and then swaps ~20 indexes from `user_id` to
`workspace_id`. Order matters throughout: backfill has to happen between "add
column" and "SET NOT NULL", and the personal workspaces have to exist before
anything points a foreign key at them.

If it had been run halfway by hand, re-running the original file would fail
(`CREATE TYPE "WorkspaceRole"` would report the type already exists, and the
`workspaces` INSERT would hit a duplicate primary key). The bundled version
handles that case and converges instead of failing.
