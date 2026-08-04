-- =====================================================================
-- apply-0017.sql
--
-- Applies the one pending Prisma migration to the ai-finance-copilot
-- production database and records it in "_prisma_migrations" so that a
-- later `npm run db:apply` sees it as already applied.
--
--   0017_workspace_editions  sha256 6ea302ea168c82af6f8f6e627f879809a4ea48cecc2b5c47d83f1ee9422d681d
--
-- The checksum above is sha256 (hex) of the exact bytes of
-- prisma/migrations/0017_workspace_editions/migration.sql, which is
-- precisely how scripts/apply-migrations.ts computes it.
--
-- HOW TO RUN: paste this entire file into the Supabase SQL Editor
-- (New query) and press Run. See README.md next to this file.
--
-- PREREQUISITE: 0016_multi_bank_connections must already be applied
-- (apply-0016.sql). 0017 adds a foreign key from "savings_goals" to
-- "bank_accounts", which 0016 creates. STEP 0a below stops with a clear
-- error instead of failing halfway if that table is missing.
--
-- WHAT IT DOES
--   1. Gives every workspace a type (BUSINESS | PERSONAL), defaulting to
--      BUSINESS so every workspace that exists today keeps the product it
--      has been using. No backfill needed.
--   2. Adds the two Personal paid tiers (PLUS, PREMIUM) to the PlanId
--      enum. The Business tiers are untouched.
--   3. Makes the pre-existing but unused "budgets" table usable: a real
--      category_id link and the rollover switch.
--   4. Adds "savings_goals" and "savings_contributions".
--
-- SAFETY PROPERTIES
--   * Everything runs inside ONE transaction, so a failure rolls the
--     whole thing back and the database is untouched.
--   * ALTER TYPE ... ADD VALUE is the one statement here that is
--     transaction-sensitive. PostgreSQL 12+ allows it inside a
--     transaction as long as the new labels are not used before the
--     commit, and nothing below mentions PLUS or PREMIUM. Supabase runs
--     PostgreSQL 15+, so this is fine; on PostgreSQL 11 or older it
--     would need to be run outside the transaction.
--   * Safe to run more than once. Every DDL statement is idempotent, and
--     the one statement that changes rows (the budgets.category_id
--     backfill) is additionally skipped once 0017 is recorded as applied.
--   * The SQL bodies are faithful to the migration file except for added
--     idempotency guards (IF NOT EXISTS / DO blocks / re-run guards).
--     No semantics change on a first, clean application.
--   * Nothing here touches "transactions", so imported rows and their
--     dedupe fingerprints — sha256("<provider>|<externalId>"), unique on
--     (workspace_id, hash) — are left exactly as they are.
--   * Nothing here drops or narrows anything. It is columns, tables,
--     indexes and enum labels only, which is why a Business workspace
--     cannot notice this migration at all.
-- =====================================================================

BEGIN;

-- Supabase's SQL Editor role has a short statement timeout. Adding a
-- NOT NULL column with a non-volatile default is metadata-only on
-- PostgreSQL 11+, so nothing here rewrites a table, but give it room
-- anyway.
SET LOCAL statement_timeout = '600s';
-- Fail fast with a clear error instead of hanging behind a stuck session.
SET LOCAL lock_timeout = '60s';


-- =====================================================================
-- STEP 0.  Bookkeeping table
-- Exact DDL used by scripts/apply-migrations.ts (MIGRATIONS_TABLE_DDL),
-- so this works even on a database that was provisioned with `db:push`
-- and therefore has no "_prisma_migrations" table at all.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum"            VARCHAR(64) NOT NULL,
  "finished_at"         TIMESTAMPTZ,
  "migration_name"      VARCHAR(255) NOT NULL,
  "logs"                TEXT,
  "rolled_back_at"      TIMESTAMPTZ,
  "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);


-- ---------------------------------------------------------------------
-- STEP 0a.  Refuse to run on a database that predates 0016.
--
-- "savings_goals" gets a foreign key to "bank_accounts", so without 0016
-- this transaction would fail on that one statement. Checking the schema
-- rather than the bookkeeping row is deliberate: a `db:push` database has
-- the table without the history row, and that is a perfectly fine place
-- to apply 0017.
-- ---------------------------------------------------------------------

DO $prereq$
BEGIN
    IF to_regclass('"bank_accounts"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "bank_accounts", which 0016_multi_bank_connections creates. Run ops/migrations-bundle/apply-0016.sql first, then run this file.';
    END IF;
    IF to_regclass('"budgets"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "budgets", which 0001_init creates. This does not look like an ai-finance-copilot database.';
    END IF;
END
$prereq$;


-- ---------------------------------------------------------------------
-- STEP 0b.  Baseline 0001..0016 if the table was just created.
--
-- Production should already have all sixteen rows: apply-0016.sql wrote
-- 0016 (and baselined 0001..0015) in the same transaction as its DDL.
-- This block is therefore expected to do nothing. It exists for the case
-- where "_prisma_migrations" is missing or empty, where recording only
-- 0017 would leave 0001..0016 looking pending and the next
-- `npm run db:apply` would try to re-run 0001_init and fail with
-- "type TransactionType already exists".
--
-- STEP 0a has already established that the 0016 schema is present, so
-- baselining it here is a statement of fact, not a guess.
--
-- The checksums are the sha256 of the migration files as committed here,
-- re-verified against apply-0016.sql — all sixteen are unchanged since
-- that bundle was generated.
-- ---------------------------------------------------------------------

DO $baseline$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations") THEN
        RAISE NOTICE 'No migration history found: baselining 0001..0016 as already applied.';

        INSERT INTO "_prisma_migrations"
            ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
        VALUES
            (gen_random_uuid()::text, '332fe85d68cc2b7f59e185a80d59f0ab77a3190731c9bd04198c8c12ec9670d8', now(), '0001_init',                    'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e039b143a3efcd37cd5510da397e5c9c9257c88e47a2b9413f827a07a57e58de', now(), '0002_conversations',           'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f13fdae0cab023db0aa497a18c3806e93dc8b0cd0791f8a3d3efdb137c0c572c', now(), '0003_assumptions',             'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '173b3ba227e28f44e7edfb84717f486e51a5479f9f75593db47515794a6c371a', now(), '0004_invoices',                'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'a561ec34107a955ddcf90641fbf6c1e4046cb93bf5389c402704757e34a87aef', now(), '0005_invoice_direction',       'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3a1ec7964d65c7cd22dbcd8c10978d44e7401a234cbccf728944a0d7c579130e', now(), '0006_notifications',           'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '16646d546727f9682c96010e1b4b2363e190cfa152cd807ca70c42f44d1614c7', now(), '0007_saas',                    'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e0ef73f1d3051871ff83d759b1c98784eeec39175623c2e4edd6c5beec91b824', now(), '0008_integrations',            'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '35a31eb5a75dec76d5e2973b75df8d3d1f5d0aa5b91fff1e0318cbef4cc5c633', now(), '0009_performance_indexes',     'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3d335be70a6bb0bc7903e2fe6810b75c3dec1e2e6a18c365e170b28907683d7c', now(), '0010_ai_provider_groq',        'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6c568731d02e58f11fadd7303584610fe1ad72a2c51b64e17ddbc3f91a098337', now(), '0011_business_profile',        'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'd0497dffcd8646003887e8eb6ccc0a480460eecb97beca6e70b8d258b346a84f', now(), '0012_default_ai_provider_groq', 'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d', now(), '0013_help_messages',           'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e', now(), '0014_workspaces',              'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f', now(), '0015_extraction_telemetry',    'baselined by apply-0017.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f92b0da30a50ac653bd603aa512c1a5fdb3fdd9227cb02218b503ae4d72b5fb8', now(), '0016_multi_bank_connections',  'baselined by apply-0017.sql', NULL, now(), 1);
    END IF;
END
$baseline$;


-- ---------------------------------------------------------------------
-- STEP 0c.  Clear out any failed / rolled-back attempt for 0017.
-- scripts/apply-migrations.ts refuses to run (throws) when it finds such
-- a row, so removing it here keeps `npm run db:apply` usable afterwards.
-- ---------------------------------------------------------------------

DELETE FROM "_prisma_migrations"
 WHERE "migration_name" = '0017_workspace_editions'
   AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL);


-- ---------------------------------------------------------------------
-- STEP 0d.  Tell the operator what is about to happen.
-- ---------------------------------------------------------------------

DO $preflight$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "_prisma_migrations"
         WHERE "migration_name" = '0017_workspace_editions'
           AND "finished_at" IS NOT NULL
           AND "rolled_back_at" IS NULL
    ) THEN
        RAISE NOTICE '0017_workspace_editions is already recorded as applied; this run is a no-op and will only re-check.';
    ELSE
        RAISE NOTICE 'Applying 0017_workspace_editions.';
    END IF;
END
$preflight$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0017_workspace_editions
-- sha256 6ea302ea168c82af6f8f6e627f879809a4ea48cecc2b5c47d83f1ee9422d681d
--
-- Ships two editions of Ballast from one codebase: the existing Business
-- edition and a new Personal edition for individuals.
--
-- Everything stays shared — transactions, categories, bank connections,
-- forecasts, notifications all work for both editions. What differs is
-- which surfaces the application exposes, and that is decided in code
-- from "workspaces"."type".
-- =====================================================================
-- =====================================================================

-- --------------------------------------------------- 1. the workspace type

DO $workspace_type$
BEGIN
    IF to_regtype('"WorkspaceType"') IS NULL THEN
        CREATE TYPE "WorkspaceType" AS ENUM ('BUSINESS', 'PERSONAL');
    END IF;
END
$workspace_type$;

-- DEFAULT 'BUSINESS' is what makes this safe on a live database: the column
-- is NOT NULL from the start and every existing workspace is stamped
-- BUSINESS, which is the edition they were created in.
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "type" "WorkspaceType" NOT NULL DEFAULT 'BUSINESS';

-- Edition-wide queries (admin KPIs, per-edition counts) filter on it.
CREATE INDEX IF NOT EXISTS "workspaces_type_idx" ON "workspaces"("type");

-- ------------------------------------------------- 2. Personal plan tiers
--
-- IF NOT EXISTS makes the re-run a no-op. These two labels are not used
-- anywhere below, which is what allows ALTER TYPE ADD VALUE to sit inside
-- this transaction on PostgreSQL 12+.

ALTER TYPE "PlanId" ADD VALUE IF NOT EXISTS 'PLUS';
ALTER TYPE "PlanId" ADD VALUE IF NOT EXISTS 'PREMIUM';

-- ------------------------------------------------------------ 3. budgets

ALTER TABLE "budgets"
  ADD COLUMN IF NOT EXISTS "category_id" TEXT,
  ADD COLUMN IF NOT EXISTS "rollover"    BOOLEAN NOT NULL DEFAULT false;

-- budgets.category holds the category NAME and stays the uniqueness key.
-- Resolve it to an id where a category of that name exists in the same
-- workspace; categories are unique on (workspace_id, name), so this cannot
-- match more than one row.
--
-- Two re-run guards on top of the original statement, neither of which
-- changes anything on a clean first run (category_id was just added, so
-- every value is NULL):
--   * "b.category_id IS NULL" never overwrites a link the application has
--     since set — after 0017 the app writes category_id directly, and the
--     user may well have pointed a budget at a renamed category.
--   * the NOT EXISTS check on the 0017 bookkeeping row: once the migration
--     is recorded, this UPDATE does nothing at all.
UPDATE "budgets" b
   SET "category_id" = c."id"
  FROM "categories" c
 WHERE c."workspace_id" = b."workspace_id"
   AND c."name" = b."category"
   AND b."category_id" IS NULL
   AND NOT EXISTS (
       SELECT 1 FROM "_prisma_migrations" m
        WHERE m."migration_name" = '0017_workspace_editions'
          AND m."finished_at" IS NOT NULL
          AND m."rolled_back_at" IS NULL
   );

-- A budget for a category that no longer exists is meaningless, so it goes
-- with the category.
ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "budgets_category_id_fkey";
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "budgets_workspace_id_year_month_idx"
    ON "budgets"("workspace_id", "year", "month");

-- ------------------------------------------------------- 4. savings goals

CREATE TABLE IF NOT EXISTS "savings_goals" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target_amount" DECIMAL(12,2) NOT NULL,
    "target_date" TIMESTAMP(3),
    "starting_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "category_id" TEXT,
    "bank_account_id" TEXT,
    "note" TEXT,
    "achieved_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "savings_goals_workspace_id_name_key"
    ON "savings_goals"("workspace_id", "name");

CREATE INDEX IF NOT EXISTS "savings_goals_workspace_id_created_at_idx"
    ON "savings_goals"("workspace_id", "created_at" DESC);

ALTER TABLE "savings_goals" DROP CONSTRAINT IF EXISTS "savings_goals_workspace_id_fkey";
ALTER TABLE "savings_goals"
    ADD CONSTRAINT "savings_goals_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "savings_goals" DROP CONSTRAINT IF EXISTS "savings_goals_user_id_fkey";
ALTER TABLE "savings_goals"
    ADD CONSTRAINT "savings_goals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The links are conveniences, not the goal's identity: losing the category
-- or the account must not delete the goal or its history.
ALTER TABLE "savings_goals" DROP CONSTRAINT IF EXISTS "savings_goals_category_id_fkey";
ALTER TABLE "savings_goals"
    ADD CONSTRAINT "savings_goals_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "savings_goals" DROP CONSTRAINT IF EXISTS "savings_goals_bank_account_id_fkey";
ALTER TABLE "savings_goals"
    ADD CONSTRAINT "savings_goals_bank_account_id_fkey"
    FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "savings_contributions" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savings_contributions_pkey" PRIMARY KEY ("id")
);

-- One contribution per transaction per goal, so recognising the same bank
-- row twice cannot double-count it. Postgres treats NULLs as distinct, so
-- hand-entered contributions (transaction_id IS NULL) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "savings_contributions_goal_id_transaction_id_key"
    ON "savings_contributions"("goal_id", "transaction_id");

CREATE INDEX IF NOT EXISTS "savings_contributions_goal_id_date_idx"
    ON "savings_contributions"("goal_id", "date" DESC);

ALTER TABLE "savings_contributions" DROP CONSTRAINT IF EXISTS "savings_contributions_goal_id_fkey";
ALTER TABLE "savings_contributions"
    ADD CONSTRAINT "savings_contributions_goal_id_fkey"
    FOREIGN KEY ("goal_id") REFERENCES "savings_goals"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;



-- =====================================================================
-- STEP 9.  Record the migration in "_prisma_migrations".
--
-- Columns and values match exactly what scripts/apply-migrations.ts writes
-- on success:
--   (id, checksum, finished_at, migration_name, logs, started_at,
--    applied_steps_count) = (uuid, sha256-hex, now(), name, NULL, now(), 1)
-- rolled_back_at is left NULL.
--
-- The INSERT is a no-op if a row for 0017 already exists, so an existing
-- record is never duplicated.
-- =====================================================================

INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text,
       '6ea302ea168c82af6f8f6e627f879809a4ea48cecc2b5c47d83f1ee9422d681d',
       now(), '0017_workspace_editions', NULL, NULL, now(), 1
 WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '0017_workspace_editions'
);


COMMIT;


-- =====================================================================
-- =====================================================================
-- VERIFICATION (read-only, runs after the COMMIT above)
--
-- If the transaction failed, none of these run and nothing was changed.
-- The Supabase SQL Editor shows the result of the LAST query, which is
-- the summary table in check 4 — read that one first.
-- =====================================================================
-- =====================================================================

-- Check 1: migration history. Expect 17 rows, 0017 present with a
-- finished_at timestamp and no rolled_back_at.
SELECT "migration_name",
       "checksum",
       "finished_at",
       "rolled_back_at",
       "applied_steps_count"
  FROM "_prisma_migrations"
 ORDER BY "migration_name";

-- Check 2: the editions. Every workspace that existed before this
-- migration must read BUSINESS; PERSONAL rows only appear once someone
-- signs up "for myself" or creates a personal workspace.
SELECT "type", count(*) AS "workspaces"
  FROM "workspaces"
 GROUP BY "type"
 ORDER BY "type";

-- Check 3: the shape of the new/changed tables and the PlanId labels.
SELECT 'PlanId label' AS "kind", e."enumlabel" AS "name", e."enumsortorder"::text AS "detail"
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e."enumtypid"
 WHERE t."typname" = 'PlanId'
UNION ALL
SELECT 'WorkspaceType label', e."enumlabel", e."enumsortorder"::text
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e."enumtypid"
 WHERE t."typname" = 'WorkspaceType'
UNION ALL
SELECT 'index', i."indexname", i."tablename"
  FROM pg_indexes i
 WHERE i."schemaname" = current_schema()
   AND i."tablename" IN ('workspaces', 'budgets', 'savings_goals', 'savings_contributions')
 ORDER BY 1, 3, 2;

-- Check 4: the summary. Every row should read 'OK'.
WITH checks (sort_order, check_name, expected, actual) AS (
    VALUES
        (1, 'migration 0017_workspace_editions recorded'::text, 'yes'::text,
            (SELECT CASE WHEN count(*) > 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0017_workspace_editions'
                AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)),
        (2, 'recorded checksum matches the repo file', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0017_workspace_editions'
                AND "checksum" = '6ea302ea168c82af6f8f6e627f879809a4ea48cecc2b5c47d83f1ee9422d681d')),
        (3, 'no failed/rolled-back migration rows', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL)),
        (4, 'full migration history present', '17 of 17',
            (SELECT count(DISTINCT "migration_name") || ' of 17'
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
                AND "migration_name" IN (
                    '0001_init', '0002_conversations', '0003_assumptions', '0004_invoices',
                    '0005_invoice_direction', '0006_notifications', '0007_saas',
                    '0008_integrations', '0009_performance_indexes', '0010_ai_provider_groq',
                    '0011_business_profile', '0012_default_ai_provider_groq',
                    '0013_help_messages', '0014_workspaces', '0015_extraction_telemetry',
                    '0016_multi_bank_connections', '0017_workspace_editions'))),
        (5, 'enum WorkspaceType has both editions', '2 of 2',
            (SELECT count(*) || ' of 2'
               FROM pg_enum e JOIN pg_type t ON t.oid = e."enumtypid"
              WHERE t."typname" = 'WorkspaceType'
                AND e."enumlabel" IN ('BUSINESS', 'PERSONAL'))),
        (6, 'workspaces.type is NOT NULL and defaults to BUSINESS', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'workspaces' AND column_name = 'type'
                AND is_nullable = 'NO'
                AND column_default LIKE '%BUSINESS%')),
        -- Every workspace ends up with an edition; check 2 above shows the
        -- split. Right after this migration it is all BUSINESS, and PERSONAL
        -- rows appearing later is the feature working, not a problem.
        (7, 'every workspace has an edition', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' without one' END::text
               FROM "workspaces" WHERE "type" IS NULL)),
        (8, 'index on workspaces.type exists', 'yes',
            (SELECT CASE WHEN to_regclass('"workspaces_type_idx"') IS NOT NULL THEN 'yes' ELSE 'NO' END::text)),
        (9, 'PlanId has the Personal tiers', '2 of 2',
            (SELECT count(*) || ' of 2'
               FROM pg_enum e JOIN pg_type t ON t.oid = e."enumtypid"
              WHERE t."typname" = 'PlanId' AND e."enumlabel" IN ('PLUS', 'PREMIUM'))),
        (10, 'PlanId still has the Business tiers', '4 of 4',
            (SELECT count(*) || ' of 4'
               FROM pg_enum e JOIN pg_type t ON t.oid = e."enumtypid"
              WHERE t."typname" = 'PlanId'
                AND e."enumlabel" IN ('FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'))),
        (11, 'budgets has category_id and rollover', '2 of 2',
            (SELECT count(*) || ' of 2'
               FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'budgets'
                AND column_name IN ('category_id', 'rollover'))),
        (12, 'budgets FK cascades from its category', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_constraint
              WHERE "conname" = 'budgets_category_id_fkey'
                AND "contype" = 'f' AND "confdeltype" = 'c' AND "confupdtype" = 'c')),
        (13, 'every budget resolved to a category', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' unresolved (a budget naming a deleted category)' END::text
               FROM "budgets" WHERE "category_id" IS NULL)),
        (14, 'table savings_goals exists', 'yes',
            (SELECT CASE WHEN to_regclass('"savings_goals"') IS NOT NULL THEN 'yes' ELSE 'NO' END::text)),
        (15, 'savings_goals has its 14 columns', '14 of 14',
            (SELECT count(*) || ' of 14'
               FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'savings_goals'
                AND column_name IN ('id', 'workspace_id', 'user_id', 'name', 'target_amount',
                                    'target_date', 'starting_amount', 'category_id',
                                    'bank_account_id', 'note', 'achieved_at', 'archived_at',
                                    'created_at', 'updated_at'))),
        (16, 'savings_goals unique (workspace_id, name)', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_index i JOIN pg_class ix ON ix.oid = i."indexrelid"
              WHERE ix."relname" = 'savings_goals_workspace_id_name_key' AND i."indisunique")),
        (17, 'savings_goals survives losing a category or account', '2 of 2',
            (SELECT count(*) || ' of 2'
               FROM pg_constraint
              WHERE "conname" IN ('savings_goals_category_id_fkey',
                                  'savings_goals_bank_account_id_fkey')
                AND "contype" = 'f' AND "confdeltype" = 'n')),
        (18, 'table savings_contributions exists', 'yes',
            (SELECT CASE WHEN to_regclass('"savings_contributions"') IS NOT NULL THEN 'yes' ELSE 'NO' END::text)),
        (19, 'contributions are unique per (goal, transaction)', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_index i JOIN pg_class ix ON ix.oid = i."indexrelid"
              WHERE ix."relname" = 'savings_contributions_goal_id_transaction_id_key'
                AND i."indisunique")),
        (20, 'contributions cascade from their goal', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_constraint
              WHERE "conname" = 'savings_contributions_goal_id_fkey'
                AND "contype" = 'f' AND "confdeltype" = 'c')),
        (21, 'bank_accounts from 0016 still in place', 'yes',
            (SELECT CASE WHEN to_regclass('"bank_accounts"') IS NOT NULL THEN 'yes' ELSE 'NO' END::text)),
        (22, 'transaction dedupe index still in place', 'yes',
            (SELECT CASE WHEN to_regclass('"transactions_workspace_id_hash_key"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (23, 'no duplicate transaction fingerprints', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' duplicated' END::text
               FROM (SELECT "workspace_id", "hash"
                       FROM "transactions"
                      GROUP BY 1, 2 HAVING count(*) > 1) d))
)
SELECT sort_order AS "#",
       check_name AS "check",
       expected   AS "expected",
       actual     AS "actual",
       CASE WHEN expected = actual THEN 'OK' ELSE '*** LOOK AT THIS ***' END AS "result"
  FROM checks
 ORDER BY sort_order;
