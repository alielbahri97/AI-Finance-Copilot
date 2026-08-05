# How to bring production back up

Applying pending Prisma migrations from any browser (including a phone),
because the machine that has the repo cannot reach Postgres directly.

There have been four rounds. Each has its own file to paste:

| Round | Migrations | File |
| --- | --- | --- |
| 1 (done) | `0013`, `0014`, `0015` | [`apply-pending-migrations.sql`](./apply-pending-migrations.sql) |
| 2 (done) | `0016_multi_bank_connections` | [`apply-0016.sql`](./apply-0016.sql) |
| 3 | `0017_workspace_editions` | [`apply-0017.sql`](./apply-0017.sql) |
| 4 | `0018_ai_categorization` | [`apply-0018.sql`](./apply-0018.sql) |

Run them in order; each round checks for the previous round's schema and
refuses to run without it. Everything from "Step A" onwards describes round 1,
but the mechanics — backup, paste the whole file, press Run, read the last
result table — are the same for all of them.

---

## Round 4: `0018_ai_categorization`

AI categorization of imported transactions. Rows that no `CategoryRule`
matches are sent to the AI in batches on CSV import and on bank sync, and only
suggestions the model is at least 80% sure of are written. Two columns is
everything the database needs for that:

- `workspaces.ai_categorization_enabled` (`BOOLEAN NOT NULL DEFAULT true`) —
  the per-workspace opt-out in Settings.
- `usage_records.ai_categorizations` (`INTEGER NOT NULL DEFAULT 0`) — the
  monthly meter the Free tier's 100-row allowance is enforced against, next to
  the existing `ai_messages`, `csv_imports` and `invoice_extractions` counters.

Both are `ADD COLUMN` with a constant default, which PostgreSQL applies as
metadata only: no table rewrite, no backfill, no long lock. Nothing is dropped,
narrowed or renamed, and no statement in the file changes a row of data.

File to paste:

```text
ops/migrations-bundle/apply-0018.sql
```

What to do:

1. **Back up.** Supabase → **Database → Backups**. Note the latest
   Point-in-Time Recovery timestamp. This one is about as low-risk as a
   migration gets, but the habit is cheap.
2. **Paste all of it** into Supabase → **SQL Editor → New query**, in the
   **production** project, and press **Run**.
3. **Read the last result table.** It has 10 rows; every one should say `OK` in
   the `result` column. Scroll up for the migration history (expect 18 rows,
   `0001`–`0018`) and the definitions of the two new columns.
4. **Load the site**, and check `https://app.ballastmoney.com/api/health` —
   `status: "ok"`, `schema: "ok"`, empty `missingTables`, `missingColumns` and
   `pendingMigrations`.

If it errors: nothing was changed (single transaction), so send me the full
error. One error has a specific answer here:

- **`This database is missing "workspaces"."type" …`** — round 3 was never
  applied. Run [`apply-0017.sql`](./apply-0017.sql) first, then this file. The
  refusal happens before anything is changed.

**Instant Rollback is safe for this one.** The pre-0018 code never reads either
column and 0018 removes nothing, so an older deployment runs unchanged on the
new schema.

---

## Round 3: `0017_workspace_editions`

The Personal edition. One codebase now ships two products, and which one a
workspace runs is a column: `workspaces.type` is `BUSINESS` or `PERSONAL`,
defaulting to `BUSINESS`, so every workspace that exists today keeps exactly
the app it has been using. The migration also adds the two Personal plan tiers
to the `PlanId` enum (`PLUS`, `PREMIUM`), makes the long-dormant `budgets`
table usable (a real `category_id` link and a `rollover` switch), and adds
`savings_goals` plus `savings_contributions`.

Nothing is dropped, narrowed or renamed. It is columns, tables, indexes and two
enum labels, which is why a Business workspace cannot notice it at all.

File to paste:

```text
ops/migrations-bundle/apply-0017.sql
```

What to do:

1. **Back up.** Supabase → **Database → Backups**. Note the latest
   Point-in-Time Recovery timestamp (or take a snapshot). This one adds rather
   than rewrites, so it is quick and low-risk — but the habit is cheap.
2. **Paste all of it** into Supabase → **SQL Editor → New query**, in the
   **production** project, and press **Run**. Supabase may warn that the query
   looks destructive because it contains `ALTER TABLE`. Confirm.
3. **Read the last result table.** It has 23 rows; every one should say `OK` in
   the `result` column. Scroll up for three more result sets: the migration
   history (expect 17 rows, `0001`–`0017`), the per-edition workspace counts,
   and the enum labels and indexes on the new/changed tables.
4. **Load the site**, and check `https://app.ballastmoney.com/api/health` —
   `status: "ok"`, `schema: "ok"`, empty `missingTables`, `missingColumns` and
   `pendingMigrations`.

Right after the migration, result set 2 shows every workspace as `BUSINESS`.
`PERSONAL` rows appear only once someone signs up via "For myself" or creates a
personal workspace from the switcher; that is the feature working, not drift.

If it errors: nothing was changed (single transaction), so send me the full
error. Two errors have specific answers here:

- **`This database is missing "bank_accounts" …`** — round 2 was never applied.
  Run [`apply-0016.sql`](./apply-0016.sql) first, then this file. The refusal
  happens before anything is changed.
- **`ALTER TYPE ... ADD cannot run inside a transaction block`** — should not
  happen on Supabase (PostgreSQL 12+ allows it, and the new labels are not used
  before the `COMMIT`). If it does, run these two lines on their own in a
  separate query and then re-run the whole file:

  ```sql
  ALTER TYPE "PlanId" ADD VALUE IF NOT EXISTS 'PLUS';
  ALTER TYPE "PlanId" ADD VALUE IF NOT EXISTS 'PREMIUM';
  ```

**Instant Rollback is safe for this one**, unlike 0014 and 0016. The pre-0017
code neither reads `workspaces.type` nor writes the new tables, and 0017 removes
nothing it depends on — so an older deployment runs unchanged on the new schema.
The only visible effect of rolling back is that the Personal edition disappears
along with the code that serves it.

---

## Round 2: `0016_multi_bank_connections`

`/api/health` reports `schema: "outdated"` with `missingTables: ["bank_accounts"]`
and `missingColumns: ["integration_connections.external_id",
"integration_connections.display_name"]`. The multi-bank code is deployed; its
schema is not. 0016 adds `external_id` (so a connection is identified by the
bank rather than by "one per provider"), the labelling columns, the
`bank_accounts` table, and it migrates the per-account data that used to live in
the GoCardless connection's `metadata` blob.

File to paste:

```text
ops/migrations-bundle/apply-0016.sql
```

What to do:

1. **Back up.** Supabase → **Database → Backups**. Note the latest
   Point-in-Time Recovery timestamp (or take a snapshot).
2. **Paste all of it** into Supabase → **SQL Editor → New query**, in the
   **production** project, and press **Run**. Supabase may warn that the query
   looks destructive — it contains `ALTER TABLE` and a `DROP INDEX`. Confirm.
3. **Read the last result table.** It has 19 rows; every one should say `OK` in
   the `result` column. Scroll up for three more result sets: the migration
   history (expect 16 rows, `0001`–`0016`), your connections with the accounts
   now attached to each, and the index list for `integration_connections` and
   `bank_accounts`.
4. **Load the site**, and check `https://app.ballastmoney.com/api/health` —
   it should now report `status: "ok"` and `schema: "ok"` with empty
   `missingTables`, `missingColumns` and `pendingMigrations`.

The one row worth reading closely is **check 14, "every bank connection got an
external_id"**. The backfill takes the GoCardless connection's id from
`metadata.institutionId`, which the old callback did store — so this should say
`OK`. If it instead reports `1 without one`, the live connection could not be
keyed to its bank, and the *next* time that bank is connected the app would add
a second connection next to it rather than updating it (and the cash total would
count that bank twice). Nothing is broken at that moment, and no data is lost —
send me the row and the second result set and I will key the row by hand.

If it errors: nothing was changed (single transaction), so send me the full
error. The script is safe to run again; every statement is idempotent and the
statements that write rows are skipped once 0016 is recorded as applied.

**Do not use Vercel Instant Rollback after applying 0016** — same rule as 0014,
for the same reason. The pre-0016 code upserts connections against
`UNIQUE (workspace_id, provider)`, which 0016 replaces, so on the old code every
connect, reconnect and OAuth callback would fail with "no unique or exclusion
constraint matching the ON CONFLICT specification". If the new deployment
misbehaves, roll *forward*.

---

## What is wrong (round 1)

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

## What the fix is (round 1)

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

**Line-ending caveat.** `db:apply` hashes the migration file's bytes as they sit
on disk, and Git on Windows with `core.autocrlf=true` rewrites LF to CRLF on
checkout — so the same file hashes differently on different machines. The
bundles were generated on Windows, and three files (`0010`, `0011`, `0012`) were
checked out CRLF there, so it is their **CRLF** checksums that the baseline
block records. On Linux/macOS, `db:apply` will therefore print a "checksum
mismatch" warning for those three. `0013`–`0016` are LF everywhere and match on
any platform.

The warning is cosmetic either way: `db:apply` neither re-runs the migration nor
fails on it. It only ever appears at all if the baseline block ran, which
happens only on a database with no migration history — production's rows came
from round 1, so this does not apply there.

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

| Migration | sha256 | Recorded by |
| --- | --- | --- |
| `0013_help_messages` | `c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d` | `apply-pending-migrations.sql` |
| `0014_workspaces` | `0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e` | `apply-pending-migrations.sql` |
| `0015_extraction_telemetry` | `c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f` | `apply-pending-migrations.sql` |
| `0016_multi_bank_connections` | `f92b0da30a50ac653bd603aa512c1a5fdb3fdd9227cb02218b503ae4d72b5fb8` | `apply-0016.sql` |
| `0017_workspace_editions` | `6ea302ea168c82af6f8f6e627f879809a4ea48cecc2b5c47d83f1ee9422d681d` | `apply-0017.sql` |
| `0018_ai_categorization` | `3a670714d7c810ec2a5756b1f1ba214422e79bc2b3f310eb0a80165141079500` | `apply-0018.sql` |

**Important:** these checksums describe the migration files as they were when
this bundle was generated. They were re-verified against the migration files as
committed alongside this README and they match. If any of those files changes
afterwards, `npm run db:apply` will print a "checksum mismatch" *warning* (it
will not re-run the migration and it will not fail). If you see that warning,
tell me and I will regenerate the bundle.

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

### How `apply-0016.sql` differs from `0016`'s migration file

Same three kinds of guard, none of which changes anything on a clean first run:

- `IF NOT EXISTS` on the four `ADD COLUMN`s, the table and all four indexes, and
  `DROP CONSTRAINT IF EXISTS` before the foreign key.
- The `DROP INDEX` of the old provider-wide unique became a `DO` block that
  drops it as a *constraint* if that is how the database happens to hold it —
  `DROP INDEX` refuses to touch an index a constraint owns.
- The backfills only ever fill blanks (`COALESCE`, plus `IS NULL` in the
  `WHERE`), and every row-touching statement additionally does nothing once
  0016 is recorded in `_prisma_migrations`. This is the 0014 lesson: a bare
  `UPDATE ... SET external_id = metadata->>'institutionId'` would, on a second
  run, overwrite an id the app had since re-keyed and stamp the bank's name back
  over a label the user had changed.

Verified mechanically rather than by eye, with no database involved: the file
and the original migration were each replayed into a real PostgreSQL engine
(PGlite, Postgres compiled to wasm) on top of a database built by replaying
0001–0015, and the resulting schemas compared — identical, 267 columns, 81
indexes, 263 constraints, 196 `NOT NULL` columns — as was the resulting data,
on a seeded copy of production's connection shapes. Also checked: applying it
three times in a row changes nothing after the first; user edits
(`display_name`, `include_in_totals`) and rows written by the running app
survive a re-run; it converges from a half-applied state; a deliberate failure
injected before the `COMMIT` leaves the database untouched; and the real
PostgreSQL parser reports one `BEGIN`, one `COMMIT`, read-only `SELECT`s after
it, and nothing that cannot run inside a transaction.

### How `apply-0017.sql` differs from `0017`'s migration file

- `IF NOT EXISTS` on the two `ADD COLUMN`s per table, both new tables, all five
  indexes, and both new enum labels; `CREATE TYPE "WorkspaceType"` became a `DO`
  block guarded on `to_regtype`, which has no `IF NOT EXISTS` form.
  `DROP CONSTRAINT IF EXISTS` precedes each of the six foreign keys.
- The one statement that changes rows — resolving `budgets.category` (a name) to
  `budgets.category_id` — only ever fills blanks, and additionally does nothing
  once 0017 is recorded in `_prisma_migrations`. That matters because after this
  migration the app writes `category_id` itself: a bare re-run of the original
  `UPDATE` would relink a budget the user had since pointed elsewhere.
- A prerequisite check up front (`STEP 0a`) that stops with a readable error if
  `bank_accounts` is missing, rather than failing halfway through on the
  `savings_goals` → `bank_accounts` foreign key.
- The baseline block records 0001–**0016** rather than 0001–0015.

Verified the same way as the 0016 bundle, on top of a database built by
replaying 0001–0016: the bundle and the original migration produce identical
schemas (291 columns, 89 indexes, 80 constraints, 64 enum labels) and identical
data, including the `budgets` backfill resolving `"Groceries"` to its category
and leaving a budget that names a deleted category unlinked. Also checked:
applying it three times changes nothing after the first; a goal and a
contribution written by the app survive a re-run, a `PERSONAL` workspace is not
reset to `BUSINESS`, and a `category_id` the app had cleared is not relinked; it
converges from a half-applied state (enum and two columns already present); the
pre-0016 refusal fires and leaves the database untouched; a failure injected
before the `COMMIT` changes nothing; and the bundle's own 23 verification checks
all report `OK` on a freshly migrated database.
