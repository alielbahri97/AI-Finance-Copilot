-- =====================================================================
-- apply-0020.sql
--
-- Applies one pending Prisma migration to the ai-finance-copilot
-- production database and records it in "_prisma_migrations" so that a
-- later `npm run db:apply` sees it as already applied.
--
--   0020_net_worth  sha256 ef31084c0ebfb00083cff17b112c6f02216cb5d5a51f72e1cf8ec47d1cc453c7
--
-- The checksum above is sha256 (hex) of the exact bytes of
-- prisma/migrations/0020_net_worth/migration.sql, which is precisely how
-- scripts/apply-migrations.ts computes it.
--
-- HOW TO RUN: paste this entire file into the Supabase SQL Editor
-- (New query) and press Run. See README.md next to this file.
--
-- PREREQUISITE: 0019_customer_dunning must already be applied
-- (apply-0019.sql). 0020 does not depend on anything 0019 creates, but
-- applying it first would leave the history out of order and hide the
-- fact that 0019 is still outstanding, so STEP 0a stops with a clear
-- error instead.
--
-- WHAT IT DOES
--   1. Creates the "AssetKind" enum (PROPERTY | VEHICLE | INVESTMENT |
--      CRYPTO | CASH | OTHER_ASSET | LOAN | MORTGAGE | CREDIT_LINE |
--      OTHER_LIABILITY) — six kinds of thing owned, four owed.
--   2. Creates "assets" — what a personal workspace owns or owes that no
--      bank connection reports: a house, a car, a fund, a mortgage. The
--      row carries no value of its own.
--   3. Creates "asset_valuations" — append-only worth-on-a-date rows.
--      The latest one is the current value; the rest are what draws the
--      net-worth line over time. They cascade with their asset.
--
-- SAFETY PROPERTIES
--   * Everything runs inside ONE transaction, so a failure rolls the
--     whole thing back and the database is untouched.
--   * Purely additive: one new enum and two new tables. No existing
--     table is altered, nothing is dropped, narrowed or renamed, and no
--     statement in this file reads or changes a single row of existing
--     data — so there is nothing to backfill and no lock worth naming.
--   * Safe to run more than once. The enum, both tables, all three
--     indexes and all three foreign keys are each guarded.
--   * The SQL bodies are faithful to the migration file except for the
--     added existence guards. No semantics change on a first, clean
--     application.
--   * Nothing here drops or narrows anything. Code deployed before this
--     migration keeps working: it simply never reads any of it.
-- =====================================================================

BEGIN;

-- Supabase's SQL Editor role has a short statement timeout. Nothing here
-- rewrites a table, but give it room anyway.
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
-- STEP 0a.  Refuse to run on a database that predates 0019.
--
-- Checking the schema rather than the bookkeeping row is deliberate: a
-- `db:push` database has the columns without the history rows, and that
-- is a perfectly fine place to apply 0020.
--
-- "assets" points a foreign key at both "workspaces" and "profiles", so
-- their absence is worth naming separately rather than failing halfway
-- through on a constraint.
-- ---------------------------------------------------------------------

DO $prereq$
BEGIN
    IF to_regclass('"workspaces"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "workspaces", which 0014_workspaces creates. This does not look like an ai-finance-copilot database.';
    END IF;
    IF to_regclass('"profiles"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "profiles", which 0001_init creates. This does not look like an ai-finance-copilot database.';
    END IF;
    IF to_regclass('"savings_goals"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "savings_goals", which 0017_workspace_editions adds. Run ops/migrations-bundle/apply-0017.sql, then apply-0018.sql and apply-0019.sql, then run this file.';
    END IF;
    IF to_regclass('"reminder_logs"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "reminder_logs", which 0019_customer_dunning adds. Run ops/migrations-bundle/apply-0019.sql first, then run this file.';
    END IF;
END
$prereq$;


-- ---------------------------------------------------------------------
-- STEP 0b.  Baseline 0001..0019 if the table was just created.
--
-- Production should already have all nineteen rows. This block exists
-- for the case where "_prisma_migrations" is missing or empty, where
-- recording only 0020 would leave 0001..0019 looking pending and the
-- next `npm run db:apply` would try to re-run 0001_init and fail with
-- "type TransactionType already exists".
--
-- STEP 0a has already established that the 0019 schema is present, so
-- baselining it here is a statement of fact, not a guess.
--
-- The checksums are the sha256 of the migration files as committed here,
-- carried over unchanged from apply-0019.sql.
-- ---------------------------------------------------------------------

DO $baseline$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations") THEN
        RAISE NOTICE 'No migration history found: baselining 0001..0019 as already applied.';

        INSERT INTO "_prisma_migrations"
            ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
        VALUES
            (gen_random_uuid()::text, '332fe85d68cc2b7f59e185a80d59f0ab77a3190731c9bd04198c8c12ec9670d8', now(), '0001_init',                    'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e039b143a3efcd37cd5510da397e5c9c9257c88e47a2b9413f827a07a57e58de', now(), '0002_conversations',           'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f13fdae0cab023db0aa497a18c3806e93dc8b0cd0791f8a3d3efdb137c0c572c', now(), '0003_assumptions',             'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '173b3ba227e28f44e7edfb84717f486e51a5479f9f75593db47515794a6c371a', now(), '0004_invoices',                'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'a561ec34107a955ddcf90641fbf6c1e4046cb93bf5389c402704757e34a87aef', now(), '0005_invoice_direction',       'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3a1ec7964d65c7cd22dbcd8c10978d44e7401a234cbccf728944a0d7c579130e', now(), '0006_notifications',           'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '16646d546727f9682c96010e1b4b2363e190cfa152cd807ca70c42f44d1614c7', now(), '0007_saas',                    'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e0ef73f1d3051871ff83d759b1c98784eeec39175623c2e4edd6c5beec91b824', now(), '0008_integrations',            'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '35a31eb5a75dec76d5e2973b75df8d3d1f5d0aa5b91fff1e0318cbef4cc5c633', now(), '0009_performance_indexes',     'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3d335be70a6bb0bc7903e2fe6810b75c3dec1e2e6a18c365e170b28907683d7c', now(), '0010_ai_provider_groq',        'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6c568731d02e58f11fadd7303584610fe1ad72a2c51b64e17ddbc3f91a098337', now(), '0011_business_profile',        'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'd0497dffcd8646003887e8eb6ccc0a480460eecb97beca6e70b8d258b346a84f', now(), '0012_default_ai_provider_groq', 'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d', now(), '0013_help_messages',           'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e', now(), '0014_workspaces',              'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f', now(), '0015_extraction_telemetry',    'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f92b0da30a50ac653bd603aa512c1a5fdb3fdd9227cb02218b503ae4d72b5fb8', now(), '0016_multi_bank_connections',  'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6ea302ea168c82af6f8f6e627f879809a4ea48cecc2b5c47d83f1ee9422d681d', now(), '0017_workspace_editions',      'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3a670714d7c810ec2a5756b1f1ba214422e79bc2b3f310eb0a80165141079500', now(), '0018_ai_categorization',       'baselined by apply-0020.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '0cd9e7a2a9099cc862fa4323ccbe5305921cc52b7f683bc4c912ba98460a2364', now(), '0019_customer_dunning',        'baselined by apply-0020.sql', NULL, now(), 1);
    END IF;
END
$baseline$;


-- ---------------------------------------------------------------------
-- STEP 0c.  Clear out any failed / rolled-back attempt for 0020.
-- scripts/apply-migrations.ts refuses to run (throws) when it finds such
-- a row, so removing it here keeps `npm run db:apply` usable afterwards.
-- ---------------------------------------------------------------------

DELETE FROM "_prisma_migrations"
 WHERE "migration_name" = '0020_net_worth'
   AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL);


-- ---------------------------------------------------------------------
-- STEP 0d.  Tell the operator what is about to happen.
-- ---------------------------------------------------------------------

DO $preflight$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "_prisma_migrations"
         WHERE "migration_name" = '0020_net_worth'
           AND "finished_at" IS NOT NULL
           AND "rolled_back_at" IS NULL
    ) THEN
        RAISE NOTICE '0020_net_worth is already recorded as applied; this run is a no-op and will only re-check.';
    ELSE
        RAISE NOTICE 'Applying 0020_net_worth.';
    END IF;
END
$preflight$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0020_net_worth
-- sha256 ef31084c0ebfb00083cff17b112c6f02216cb5d5a51f72e1cf8ec47d1cc453c7
--
-- What a personal workspace owns and owes beyond what its banks report,
-- and what each of those was worth on which date.
-- =====================================================================
-- =====================================================================

-- ------------------------------------------------- 1. the kinds of holding

-- CREATE TYPE has no IF NOT EXISTS, so it is guarded by hand. Creating
-- the type and using it later in this same transaction is fine; only
-- ALTER TYPE ... ADD VALUE has the in-transaction restriction.
DO $enum$
BEGIN
    IF to_regtype('"AssetKind"') IS NULL THEN
        CREATE TYPE "AssetKind" AS ENUM ('PROPERTY', 'VEHICLE', 'INVESTMENT', 'CRYPTO', 'CASH', 'OTHER_ASSET', 'LOAN', 'MORTGAGE', 'CREDIT_LINE', 'OTHER_LIABILITY');
    END IF;
END
$enum$;

-- ------------------------------------------------------- 2. the holdings

-- No value column on purpose: worth changes, and the history of it is
-- the whole point of the feature. "currency" is nullable and means "the
-- workspace currency" when unset.
CREATE TABLE IF NOT EXISTS "assets" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "currency" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------ 3. the valuations

CREATE TABLE IF NOT EXISTS "asset_valuations" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_valuations_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------- 4. the indexes

-- One holding per name per workspace: "Mortgage" entered twice is a
-- double-counted liability, which is the one error a net-worth page must
-- not make quietly.
CREATE UNIQUE INDEX IF NOT EXISTS "assets_workspace_id_name_key"
    ON "assets"("workspace_id", "name");

CREATE INDEX IF NOT EXISTS "assets_workspace_id_created_at_idx"
    ON "assets"("workspace_id", "created_at" DESC);

-- Every read of this table asks "what is the latest figure for this
-- asset", and the history series asks it once per month.
CREATE INDEX IF NOT EXISTS "asset_valuations_asset_id_as_of_idx"
    ON "asset_valuations"("asset_id", "as_of" DESC);

-- ----------------------------------------------------- 5. the foreign keys

DO $fks$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'assets_workspace_id_fkey'
           AND conrelid = to_regclass('"assets"')
    ) THEN
        ALTER TABLE "assets"
          ADD CONSTRAINT "assets_workspace_id_fkey"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'assets_user_id_fkey'
           AND conrelid = to_regclass('"assets"')
    ) THEN
        ALTER TABLE "assets"
          ADD CONSTRAINT "assets_user_id_fkey"
          FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- Deleting a holding takes its whole valuation history with it: the
    -- history describes that one thing and means nothing without it.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'asset_valuations_asset_id_fkey'
           AND conrelid = to_regclass('"asset_valuations"')
    ) THEN
        ALTER TABLE "asset_valuations"
          ADD CONSTRAINT "asset_valuations_asset_id_fkey"
          FOREIGN KEY ("asset_id") REFERENCES "assets"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$fks$;



-- =====================================================================
-- STEP 9.  Record the migration in "_prisma_migrations".
--
-- Columns and values match exactly what scripts/apply-migrations.ts writes
-- on success:
--   (id, checksum, finished_at, migration_name, logs, started_at,
--    applied_steps_count) = (uuid, sha256-hex, now(), name, NULL, now(), 1)
-- rolled_back_at is left NULL.
--
-- The INSERT is a no-op if a row for 0020 already exists, so an existing
-- record is never duplicated.
-- =====================================================================

INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text,
       'ef31084c0ebfb00083cff17b112c6f02216cb5d5a51f72e1cf8ec47d1cc453c7',
       now(), '0020_net_worth', NULL, NULL, now(), 1
 WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '0020_net_worth'
);


COMMIT;


-- =====================================================================
-- =====================================================================
-- VERIFICATION (read-only, runs after the COMMIT above)
--
-- If the transaction failed, none of these run and nothing was changed.
-- The Supabase SQL Editor shows the result of the LAST query, which is
-- the summary table in check 3 — read that one first.
-- =====================================================================
-- =====================================================================

-- Check 1: migration history. Expect 20 rows, 0020 present with a
-- finished_at timestamp and no rolled_back_at.
SELECT "migration_name",
       "checksum",
       "finished_at",
       "rolled_back_at",
       "applied_steps_count"
  FROM "_prisma_migrations"
 ORDER BY "migration_name";

-- Check 2: the shape of the two new tables.
SELECT "table_name", "column_name", "data_type", "is_nullable", "column_default"
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND "table_name" IN ('assets', 'asset_valuations')
 ORDER BY "table_name", "ordinal_position";

-- Check 3: the summary. Every row should read 'OK'.
WITH checks (sort_order, check_name, expected, actual) AS (
    VALUES
        (1, 'migration 0020_net_worth recorded'::text, 'yes'::text,
            (SELECT CASE WHEN count(*) > 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0020_net_worth'
                AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)),
        (2, 'recorded checksum matches the repo file', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0020_net_worth'
                AND "checksum" = 'ef31084c0ebfb00083cff17b112c6f02216cb5d5a51f72e1cf8ec47d1cc453c7')),
        (3, 'no failed/rolled-back migration rows', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL)),
        (4, 'full migration history present', '20 of 20',
            (SELECT count(DISTINCT "migration_name") || ' of 20'
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
                AND "migration_name" IN (
                    '0001_init', '0002_conversations', '0003_assumptions', '0004_invoices',
                    '0005_invoice_direction', '0006_notifications', '0007_saas',
                    '0008_integrations', '0009_performance_indexes', '0010_ai_provider_groq',
                    '0011_business_profile', '0012_default_ai_provider_groq',
                    '0013_help_messages', '0014_workspaces', '0015_extraction_telemetry',
                    '0016_multi_bank_connections', '0017_workspace_editions',
                    '0018_ai_categorization', '0019_customer_dunning', '0020_net_worth'))),
        (5, 'AssetKind enum has its ten labels in order',
            'PROPERTY,VEHICLE,INVESTMENT,CRYPTO,CASH,OTHER_ASSET,LOAN,MORTGAGE,CREDIT_LINE,OTHER_LIABILITY',
            (SELECT string_agg("enumlabel", ',' ORDER BY "enumsortorder")
               FROM pg_enum WHERE "enumtypid" = to_regtype('"AssetKind"'))),
        (6, 'assets exists', 'yes',
            (SELECT CASE WHEN to_regclass('"assets"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (7, 'asset_valuations exists', 'yes',
            (SELECT CASE WHEN to_regclass('"asset_valuations"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (8, 'assets has its nine columns', '9',
            (SELECT count(*)::text FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'assets')),
        (9, 'asset_valuations has its five columns', '5',
            (SELECT count(*)::text FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'asset_valuations')),
        (10, 'a holding cannot be entered twice under one name', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_indexes
              WHERE schemaname = current_schema()
                AND indexname = 'assets_workspace_id_name_key')),
        (11, 'the latest-valuation index is in place', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_indexes
              WHERE schemaname = current_schema()
                AND indexname = 'asset_valuations_asset_id_as_of_idx')),
        (12, 'assets foreign keys in place (workspace + profile)', '2',
            (SELECT count(*)::text FROM pg_constraint
              WHERE conrelid = to_regclass('"assets"') AND contype = 'f')),
        (13, 'valuations cascade with their asset', 'c',
            (SELECT confdeltype::text FROM pg_constraint
              WHERE conname = 'asset_valuations_asset_id_fkey'
                AND conrelid = to_regclass('"asset_valuations"'))),
        (14, 'valuation value is NOT NULL numeric(14,2)', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'asset_valuations' AND column_name = 'value'
                AND is_nullable = 'NO' AND data_type = 'numeric'
                AND numeric_precision = 14 AND numeric_scale = 2)),
        (15, 'this migration invented no holdings', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' rows' END::text
               FROM "assets")),
        (16, 'the dunning table from 0019 is still in place', 'yes',
            (SELECT CASE WHEN to_regclass('"reminder_logs"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (17, 'the savings-goal tables from 0017 are still in place', 'yes',
            (SELECT CASE WHEN to_regclass('"savings_goals"') IS NOT NULL
                          AND to_regclass('"savings_contributions"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (18, 'transaction dedupe index still in place', 'yes',
            (SELECT CASE WHEN to_regclass('"transactions_workspace_id_hash_key"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text))
)
SELECT sort_order AS "#",
       check_name AS "check",
       expected   AS "expected",
       actual     AS "actual",
       CASE WHEN expected = actual THEN 'OK' ELSE '*** LOOK AT THIS ***' END AS "result"
  FROM checks
 ORDER BY sort_order;
