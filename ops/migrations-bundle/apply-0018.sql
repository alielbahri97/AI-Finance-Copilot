-- =====================================================================
-- apply-0018.sql
--
-- Applies one pending Prisma migration to the ai-finance-copilot
-- production database and records it in "_prisma_migrations" so that a
-- later `npm run db:apply` sees it as already applied.
--
--   0018_ai_categorization  sha256 3a670714d7c810ec2a5756b1f1ba214422e79bc2b3f310eb0a80165141079500
--
-- The checksum above is sha256 (hex) of the exact bytes of
-- prisma/migrations/0018_ai_categorization/migration.sql, which is
-- precisely how scripts/apply-migrations.ts computes it.
--
-- HOW TO RUN: paste this entire file into the Supabase SQL Editor
-- (New query) and press Run. See README.md next to this file.
--
-- PREREQUISITE: 0017_workspace_editions must already be applied
-- (apply-0017.sql). 0018 does not depend on anything 0017 creates, but
-- applying it first would leave the history out of order and hide the
-- fact that 0017 is still outstanding, so STEP 0a stops with a clear
-- error instead.
--
-- WHAT IT DOES
--   1. Adds "workspaces"."ai_categorization_enabled" (BOOLEAN NOT NULL
--      DEFAULT true) — the per-workspace opt-out for AI categorization of
--      imported transactions, exposed in Settings.
--   2. Adds "usage_records"."ai_categorizations" (INTEGER NOT NULL
--      DEFAULT 0) — the monthly counter the Free tier's row allowance is
--      enforced against, alongside the existing ai_messages,
--      csv_imports and invoice_extractions counters.
--
-- SAFETY PROPERTIES
--   * Everything runs inside ONE transaction, so a failure rolls the
--     whole thing back and the database is untouched.
--   * Two ADD COLUMN statements with constant defaults. On PostgreSQL
--     11+ that is metadata-only: no table rewrite, no long lock, and
--     nothing to backfill.
--   * Safe to run more than once. Both statements use IF NOT EXISTS and
--     no statement in this file changes a single row of data.
--   * The SQL bodies are faithful to the migration file except for the
--     added IF NOT EXISTS guards. No semantics change on a first, clean
--     application.
--   * Nothing here touches "transactions", so imported rows and their
--     dedupe fingerprints are left exactly as they are.
--   * Nothing here drops or narrows anything. Code deployed before this
--     migration keeps working: it simply never reads either column.
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
-- STEP 0a.  Refuse to run on a database that predates 0017.
--
-- Checking the schema rather than the bookkeeping row is deliberate: a
-- `db:push` database has the columns without the history rows, and that
-- is a perfectly fine place to apply 0018.
-- ---------------------------------------------------------------------

DO $prereq$
BEGIN
    IF to_regclass('"usage_records"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "usage_records", which 0007_saas creates. This does not look like an ai-finance-copilot database.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'workspaces'
           AND column_name = 'type'
    ) THEN
        RAISE EXCEPTION
            'This database is missing "workspaces"."type", which 0017_workspace_editions adds. Run ops/migrations-bundle/apply-0017.sql first, then run this file.';
    END IF;
END
$prereq$;


-- ---------------------------------------------------------------------
-- STEP 0b.  Baseline 0001..0017 if the table was just created.
--
-- Production should already have all seventeen rows. This block exists
-- for the case where "_prisma_migrations" is missing or empty, where
-- recording only 0018 would leave 0001..0017 looking pending and the
-- next `npm run db:apply` would try to re-run 0001_init and fail with
-- "type TransactionType already exists".
--
-- STEP 0a has already established that the 0017 schema is present, so
-- baselining it here is a statement of fact, not a guess.
--
-- The checksums are the sha256 of the migration files as committed here,
-- re-verified against apply-0017.sql — all seventeen are unchanged since
-- that bundle was generated.
-- ---------------------------------------------------------------------

DO $baseline$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations") THEN
        RAISE NOTICE 'No migration history found: baselining 0001..0017 as already applied.';

        INSERT INTO "_prisma_migrations"
            ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
        VALUES
            (gen_random_uuid()::text, '332fe85d68cc2b7f59e185a80d59f0ab77a3190731c9bd04198c8c12ec9670d8', now(), '0001_init',                    'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e039b143a3efcd37cd5510da397e5c9c9257c88e47a2b9413f827a07a57e58de', now(), '0002_conversations',           'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f13fdae0cab023db0aa497a18c3806e93dc8b0cd0791f8a3d3efdb137c0c572c', now(), '0003_assumptions',             'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '173b3ba227e28f44e7edfb84717f486e51a5479f9f75593db47515794a6c371a', now(), '0004_invoices',                'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'a561ec34107a955ddcf90641fbf6c1e4046cb93bf5389c402704757e34a87aef', now(), '0005_invoice_direction',       'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3a1ec7964d65c7cd22dbcd8c10978d44e7401a234cbccf728944a0d7c579130e', now(), '0006_notifications',           'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '16646d546727f9682c96010e1b4b2363e190cfa152cd807ca70c42f44d1614c7', now(), '0007_saas',                    'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e0ef73f1d3051871ff83d759b1c98784eeec39175623c2e4edd6c5beec91b824', now(), '0008_integrations',            'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '35a31eb5a75dec76d5e2973b75df8d3d1f5d0aa5b91fff1e0318cbef4cc5c633', now(), '0009_performance_indexes',     'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3d335be70a6bb0bc7903e2fe6810b75c3dec1e2e6a18c365e170b28907683d7c', now(), '0010_ai_provider_groq',        'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6c568731d02e58f11fadd7303584610fe1ad72a2c51b64e17ddbc3f91a098337', now(), '0011_business_profile',        'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'd0497dffcd8646003887e8eb6ccc0a480460eecb97beca6e70b8d258b346a84f', now(), '0012_default_ai_provider_groq', 'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d', now(), '0013_help_messages',           'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e', now(), '0014_workspaces',              'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f', now(), '0015_extraction_telemetry',    'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f92b0da30a50ac653bd603aa512c1a5fdb3fdd9227cb02218b503ae4d72b5fb8', now(), '0016_multi_bank_connections',  'baselined by apply-0018.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6ea302ea168c82af6f8f6e627f879809a4ea48cecc2b5c47d83f1ee9422d681d', now(), '0017_workspace_editions',      'baselined by apply-0018.sql', NULL, now(), 1);
    END IF;
END
$baseline$;


-- ---------------------------------------------------------------------
-- STEP 0c.  Clear out any failed / rolled-back attempt for 0018.
-- scripts/apply-migrations.ts refuses to run (throws) when it finds such
-- a row, so removing it here keeps `npm run db:apply` usable afterwards.
-- ---------------------------------------------------------------------

DELETE FROM "_prisma_migrations"
 WHERE "migration_name" = '0018_ai_categorization'
   AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL);


-- ---------------------------------------------------------------------
-- STEP 0d.  Tell the operator what is about to happen.
-- ---------------------------------------------------------------------

DO $preflight$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "_prisma_migrations"
         WHERE "migration_name" = '0018_ai_categorization'
           AND "finished_at" IS NOT NULL
           AND "rolled_back_at" IS NULL
    ) THEN
        RAISE NOTICE '0018_ai_categorization is already recorded as applied; this run is a no-op and will only re-check.';
    ELSE
        RAISE NOTICE 'Applying 0018_ai_categorization.';
    END IF;
END
$preflight$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0018_ai_categorization
-- sha256 3a670714d7c810ec2a5756b1f1ba214422e79bc2b3f310eb0a80165141079500
--
-- Transactions that no CategoryRule matches are batch-categorized by the
-- AI on import and on bank sync. The two columns below are everything
-- that needs to exist in the database for that: an opt-out and a meter.
-- =====================================================================
-- =====================================================================

-- ------------------------------------------------- 1. the workspace opt-out

-- DEFAULT true is the product decision: categorization is on unless a
-- workspace turns it off in Settings. Adding the column with a constant
-- default is metadata-only, so this stays instant on a live database.
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "ai_categorization_enabled" BOOLEAN NOT NULL DEFAULT true;

-- -------------------------------------------------- 2. the monthly counter

-- Counts transactions handed to the AI, not rows it managed to place:
-- the quota buys attention, not successful guesses.
ALTER TABLE "usage_records"
  ADD COLUMN IF NOT EXISTS "ai_categorizations" INTEGER NOT NULL DEFAULT 0;



-- =====================================================================
-- STEP 9.  Record the migration in "_prisma_migrations".
--
-- Columns and values match exactly what scripts/apply-migrations.ts writes
-- on success:
--   (id, checksum, finished_at, migration_name, logs, started_at,
--    applied_steps_count) = (uuid, sha256-hex, now(), name, NULL, now(), 1)
-- rolled_back_at is left NULL.
--
-- The INSERT is a no-op if a row for 0018 already exists, so an existing
-- record is never duplicated.
-- =====================================================================

INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text,
       '3a670714d7c810ec2a5756b1f1ba214422e79bc2b3f310eb0a80165141079500',
       now(), '0018_ai_categorization', NULL, NULL, now(), 1
 WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '0018_ai_categorization'
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

-- Check 1: migration history. Expect 18 rows, 0018 present with a
-- finished_at timestamp and no rolled_back_at.
SELECT "migration_name",
       "checksum",
       "finished_at",
       "rolled_back_at",
       "applied_steps_count"
  FROM "_prisma_migrations"
 ORDER BY "migration_name";

-- Check 2: the two new columns, with their defaults.
SELECT "table_name", "column_name", "data_type", "is_nullable", "column_default"
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND (("table_name" = 'workspaces'    AND "column_name" = 'ai_categorization_enabled')
     OR ("table_name" = 'usage_records' AND "column_name" = 'ai_categorizations'))
 ORDER BY "table_name";

-- Check 3: the summary. Every row should read 'OK'.
WITH checks (sort_order, check_name, expected, actual) AS (
    VALUES
        (1, 'migration 0018_ai_categorization recorded'::text, 'yes'::text,
            (SELECT CASE WHEN count(*) > 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0018_ai_categorization'
                AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)),
        (2, 'recorded checksum matches the repo file', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0018_ai_categorization'
                AND "checksum" = '3a670714d7c810ec2a5756b1f1ba214422e79bc2b3f310eb0a80165141079500')),
        (3, 'no failed/rolled-back migration rows', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL)),
        (4, 'full migration history present', '18 of 18',
            (SELECT count(DISTINCT "migration_name") || ' of 18'
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
                AND "migration_name" IN (
                    '0001_init', '0002_conversations', '0003_assumptions', '0004_invoices',
                    '0005_invoice_direction', '0006_notifications', '0007_saas',
                    '0008_integrations', '0009_performance_indexes', '0010_ai_provider_groq',
                    '0011_business_profile', '0012_default_ai_provider_groq',
                    '0013_help_messages', '0014_workspaces', '0015_extraction_telemetry',
                    '0016_multi_bank_connections', '0017_workspace_editions',
                    '0018_ai_categorization'))),
        (5, 'workspaces.ai_categorization_enabled is NOT NULL and defaults to true', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'workspaces' AND column_name = 'ai_categorization_enabled'
                AND is_nullable = 'NO'
                AND column_default LIKE '%true%')),
        (6, 'every workspace has AI categorization on', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' switched off' END::text
               FROM "workspaces" WHERE "ai_categorization_enabled" IS NOT TRUE)),
        (7, 'usage_records.ai_categorizations is NOT NULL and defaults to 0', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'usage_records' AND column_name = 'ai_categorizations'
                AND is_nullable = 'NO'
                AND column_default LIKE '%0%')),
        (8, 'no usage row lost its existing counters', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' with a NULL counter' END::text
               FROM "usage_records"
              WHERE "ai_messages" IS NULL OR "csv_imports" IS NULL
                 OR "invoice_extractions" IS NULL OR "exports" IS NULL
                 OR "ai_categorizations" IS NULL)),
        (9, 'the editions from 0017 are still in place', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'workspaces' AND column_name = 'type')),
        (10, 'transaction dedupe index still in place', 'yes',
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
