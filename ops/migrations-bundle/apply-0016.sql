-- =====================================================================
-- apply-0016.sql
--
-- Applies the one pending Prisma migration to the ai-finance-copilot
-- production database and records it in "_prisma_migrations" so that a
-- later `npm run db:apply` sees it as already applied.
--
--   0016_multi_bank_connections  sha256 f92b0da30a50ac653bd603aa512c1a5fdb3fdd9227cb02218b503ae4d72b5fb8
--
-- The checksum above is sha256 (hex) of the exact bytes of
-- prisma/migrations/0016_multi_bank_connections/migration.sql, which is
-- precisely how scripts/apply-migrations.ts computes it.
--
-- HOW TO RUN: paste this entire file into the Supabase SQL Editor
-- (New query) and press Run. See README.md next to this file.
--
-- SAFETY PROPERTIES
--   * Everything runs inside ONE transaction. Nothing here is
--     transaction-hostile (no CREATE INDEX CONCURRENTLY, no ALTER TYPE
--     ADD VALUE, no VACUUM), so a failure rolls the whole thing back and
--     the database is untouched.
--   * Safe to run more than once. Every DDL statement is idempotent, and
--     the statements that write or change rows are additionally skipped
--     once 0016 is recorded as applied.
--   * The SQL bodies are faithful to the migration file except for added
--     idempotency guards (IF NOT EXISTS / COALESCE / ON CONFLICT DO
--     NOTHING / re-run guards). No semantics change on a first, clean
--     application.
--   * Nothing here touches "transactions", so imported rows and their
--     dedupe fingerprints — sha256("<provider>|<externalId>"), unique on
--     (workspace_id, hash) — are left exactly as they are.
-- =====================================================================

BEGIN;

-- Supabase's SQL Editor role has a short statement timeout; the table
-- rewrite ("integration_connections" gains four columns) and the index
-- swap are quick, but give them room anyway.
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
-- STEP 0b.  Baseline 0001..0015 if the table was just created.
--
-- Production should already have all fifteen rows: apply-pending-migrations.sql
-- wrote 0013/0014/0015 (and baselined 0001..0012) in the same transaction
-- as their DDL. This block is therefore expected to do nothing. It exists
-- for the case where "_prisma_migrations" is missing or empty, where
-- recording only 0016 would leave 0001..0015 looking pending and the next
-- `npm run db:apply` would try to re-run 0001_init and fail with
-- "type TransactionType already exists".
--
-- The checksums are the sha256 of the migration files as committed here,
-- re-verified against apply-pending-migrations.sql — all fifteen are
-- unchanged since that bundle was generated.
-- ---------------------------------------------------------------------

DO $baseline$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations") THEN
        RAISE NOTICE 'No migration history found: baselining 0001..0015 as already applied.';

        INSERT INTO "_prisma_migrations"
            ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
        VALUES
            (gen_random_uuid()::text, '332fe85d68cc2b7f59e185a80d59f0ab77a3190731c9bd04198c8c12ec9670d8', now(), '0001_init',                    'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e039b143a3efcd37cd5510da397e5c9c9257c88e47a2b9413f827a07a57e58de', now(), '0002_conversations',           'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f13fdae0cab023db0aa497a18c3806e93dc8b0cd0791f8a3d3efdb137c0c572c', now(), '0003_assumptions',             'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '173b3ba227e28f44e7edfb84717f486e51a5479f9f75593db47515794a6c371a', now(), '0004_invoices',                'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'a561ec34107a955ddcf90641fbf6c1e4046cb93bf5389c402704757e34a87aef', now(), '0005_invoice_direction',       'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3a1ec7964d65c7cd22dbcd8c10978d44e7401a234cbccf728944a0d7c579130e', now(), '0006_notifications',           'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '16646d546727f9682c96010e1b4b2363e190cfa152cd807ca70c42f44d1614c7', now(), '0007_saas',                    'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e0ef73f1d3051871ff83d759b1c98784eeec39175623c2e4edd6c5beec91b824', now(), '0008_integrations',            'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '35a31eb5a75dec76d5e2973b75df8d3d1f5d0aa5b91fff1e0318cbef4cc5c633', now(), '0009_performance_indexes',     'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3d335be70a6bb0bc7903e2fe6810b75c3dec1e2e6a18c365e170b28907683d7c', now(), '0010_ai_provider_groq',        'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6c568731d02e58f11fadd7303584610fe1ad72a2c51b64e17ddbc3f91a098337', now(), '0011_business_profile',        'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'd0497dffcd8646003887e8eb6ccc0a480460eecb97beca6e70b8d258b346a84f', now(), '0012_default_ai_provider_groq', 'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d', now(), '0013_help_messages',           'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e', now(), '0014_workspaces',              'baselined by apply-0016.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f', now(), '0015_extraction_telemetry',    'baselined by apply-0016.sql', NULL, now(), 1);
    END IF;
END
$baseline$;


-- ---------------------------------------------------------------------
-- STEP 0c.  Clear out any failed / rolled-back attempt for 0016.
-- scripts/apply-migrations.ts refuses to run (throws) when it finds such
-- a row, so removing it here keeps `npm run db:apply` usable afterwards.
-- ---------------------------------------------------------------------

DELETE FROM "_prisma_migrations"
 WHERE "migration_name" = '0016_multi_bank_connections'
   AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL);


-- ---------------------------------------------------------------------
-- STEP 0d.  Tell the operator what is about to happen.
-- ---------------------------------------------------------------------

DO $preflight$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "_prisma_migrations"
         WHERE "migration_name" = '0016_multi_bank_connections'
           AND "finished_at" IS NOT NULL
           AND "rolled_back_at" IS NULL
    ) THEN
        RAISE NOTICE '0016_multi_bank_connections is already recorded as applied; this run is a no-op and will only re-check.';
    ELSE
        RAISE NOTICE 'Applying 0016_multi_bank_connections.';
    END IF;
END
$preflight$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0016_multi_bank_connections
-- sha256 f92b0da30a50ac653bd603aa512c1a5fdb3fdd9227cb02218b503ae4d72b5fb8
--
-- A business commonly banks in more than one place (ING current account
-- plus a Rabobank savings account). Until now integration_connections
-- carried a UNIQUE (workspace_id, provider), so the second bank was
-- rejected outright.
--
-- Plan:
--   1. Identify a connection by the provider's own stable id
--      (external_id), backfilled from metadata where derivable.
--   2. Replace UNIQUE (workspace_id, provider) with
--      UNIQUE (workspace_id, provider, external_id) plus a PARTIAL
--      unique index for the external_id IS NULL case.
--   3. Add the labelling columns the UI needs (display_name,
--      institution_name, institution_logo).
--   4. Add bank_accounts: one row per account inside a connection, with
--      the latest balance snapshot and an include_in_totals switch.
--      Per-account data living in GoCardless connection metadata is
--      migrated into it.
-- =====================================================================
-- =====================================================================

-- --------------------------------------------------------- 1. new columns

ALTER TABLE "integration_connections"
  ADD COLUMN IF NOT EXISTS "external_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "display_name"     TEXT,
  ADD COLUMN IF NOT EXISTS "institution_name" TEXT,
  ADD COLUMN IF NOT EXISTS "institution_logo" TEXT;

-- Backfill the connection identity from what each provider already stored.
-- GoCardless keys on the institution rather than the requisition: renewing
-- consent mints a fresh requisition for the same bank and must update the
-- existing row instead of adding a duplicate bank.
--
-- Each backfill below carries two re-run guards on top of the original
-- statement, and neither changes what happens on a clean first run (the
-- four columns have just been added, so every value is NULL):
--
--   * COALESCE + "IS NULL" in the WHERE clause: only blank values are
--     filled, never overwritten. Without this, a re-run would clobber an
--     external_id that the running application had since re-keyed, and
--     stamp a provider-supplied institution_name over the row again.
--   * a NOT EXISTS check on the 0016 bookkeeping row: once the migration
--     is recorded, these UPDATEs do nothing at all. Connections created
--     after 0016 are the new code's business, not the backfill's.

UPDATE "integration_connections"
   SET "external_id"      = COALESCE("external_id", NULLIF("metadata"->>'institutionId', '')),
       "institution_name" = COALESCE("institution_name", NULLIF("metadata"->>'institutionName', ''))
 WHERE "provider" = 'gocardless'
   AND ("external_id" IS NULL OR "institution_name" IS NULL)
   AND NOT EXISTS (
       SELECT 1 FROM "_prisma_migrations" m
        WHERE m."migration_name" = '0016_multi_bank_connections'
          AND m."finished_at" IS NOT NULL
          AND m."rolled_back_at" IS NULL
   );

UPDATE "integration_connections"
   SET "external_id"      = COALESCE("external_id", NULLIF("metadata"->>'itemId', '')),
       "institution_name" = COALESCE("institution_name", NULLIF("metadata"->>'institution', ''))
 WHERE "provider" = 'plaid'
   AND ("external_id" IS NULL OR "institution_name" IS NULL)
   AND NOT EXISTS (
       SELECT 1 FROM "_prisma_migrations" m
        WHERE m."migration_name" = '0016_multi_bank_connections'
          AND m."finished_at" IS NOT NULL
          AND m."rolled_back_at" IS NULL
   );

UPDATE "integration_connections"
   SET "external_id" = NULLIF("metadata"->>'realmId', '')
 WHERE "provider" = 'quickbooks'
   AND "external_id" IS NULL
   AND NOT EXISTS (
       SELECT 1 FROM "_prisma_migrations" m
        WHERE m."migration_name" = '0016_multi_bank_connections'
          AND m."finished_at" IS NOT NULL
          AND m."rolled_back_at" IS NULL
   );

UPDATE "integration_connections"
   SET "external_id"      = COALESCE("external_id", NULLIF("metadata"->>'tenantId', '')),
       "institution_name" = COALESCE("institution_name", NULLIF("metadata"->>'tenantName', ''))
 WHERE "provider" = 'xero'
   AND ("external_id" IS NULL OR "institution_name" IS NULL)
   AND NOT EXISTS (
       SELECT 1 FROM "_prisma_migrations" m
        WHERE m."migration_name" = '0016_multi_bank_connections'
          AND m."finished_at" IS NOT NULL
          AND m."rolled_back_at" IS NULL
   );

UPDATE "integration_connections"
   SET "external_id" = NULLIF("metadata"->>'division', '')
 WHERE "provider" = 'exact'
   AND "external_id" IS NULL
   AND NOT EXISTS (
       SELECT 1 FROM "_prisma_migrations" m
        WHERE m."migration_name" = '0016_multi_bank_connections'
          AND m."finished_at" IS NOT NULL
          AND m."rolled_back_at" IS NULL
   );

-- Everything else (Slack, Teams, Gmail, Outlook, Google Calendar, Tink) keeps
-- external_id NULL: one connection per workspace is the whole intent there,
-- and the partial index below enforces it.

-- ------------------------------------------------------ 2. uniqueness swap

-- The old provider-wide unique. 0014 created it with CREATE UNIQUE INDEX,
-- so on production it is a plain index and a DROP INDEX is right. A
-- database built with `prisma db push` could instead carry it as a table
-- constraint, and DROP INDEX refuses to touch an index that a constraint
-- owns ("cannot drop index ... because constraint ... requires it").
-- Handle both spellings; either way it is gone afterwards.
DO $drop_old_unique$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE "conname" = 'integration_connections_workspace_id_provider_key'
           AND "conrelid" = to_regclass('"integration_connections"')
    ) THEN
        ALTER TABLE "integration_connections"
            DROP CONSTRAINT "integration_connections_workspace_id_provider_key";
    ELSE
        DROP INDEX IF EXISTS "integration_connections_workspace_id_provider_key";
    END IF;
END
$drop_old_unique$;

-- Both indexes below are created from a state that the dropped unique
-- guaranteed: at most one row per (workspace_id, provider). So neither can
-- find a duplicate to choke on, whatever the backfill did or did not fill in.
CREATE UNIQUE INDEX IF NOT EXISTS "integration_connections_workspace_id_provider_external_id_key"
    ON "integration_connections"("workspace_id", "provider", "external_id");

-- Postgres treats NULLs as distinct, so the index above would happily accept
-- an unbounded number of external_id-less rows for the same provider — which
-- is exactly the accidental duplicate we are trying to prevent for
-- single-instance providers and for legacy rows we could not key. A partial
-- unique index closes that hole without constraining the genuine multi-bank
-- case. (Prisma cannot express partial indexes; the schema documents it.)
CREATE UNIQUE INDEX IF NOT EXISTS "integration_connections_workspace_provider_null_key"
    ON "integration_connections"("workspace_id", "provider")
 WHERE "external_id" IS NULL;

CREATE INDEX IF NOT EXISTS "integration_connections_workspace_id_provider_idx"
    ON "integration_connections"("workspace_id", "provider");

-- --------------------------------------------------------- 3. bank_accounts

CREATE TABLE IF NOT EXISTS "bank_accounts" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "name" TEXT,
    "mask" TEXT,
    "currency" TEXT,
    "include_in_totals" BOOLEAN NOT NULL DEFAULT true,
    "last_balance" DECIMAL(14,2),
    "last_balance_at" TIMESTAMP(3),
    "balance_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_connection_id_external_account_id_key"
    ON "bank_accounts"("connection_id", "external_account_id");

ALTER TABLE "bank_accounts" DROP CONSTRAINT IF EXISTS "bank_accounts_connection_id_fkey";
ALTER TABLE "bank_accounts"
    ADD CONSTRAINT "bank_accounts_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate the per-account data GoCardless syncs had been keeping in metadata:
-- metadata.accounts is the account-id list, metadata.accountLabels the
-- positionally matching IBAN tails ("account" where the bank gave no IBAN),
-- metadata.balances a map keyed by account id ({ amount, currency, type, at }).
--
-- This is the only statement in 0016 that creates rows, so it is the only one
-- that must not run a second time. It is guarded three ways, none of which
-- changes anything on a clean first run:
--   * ids are derived ('bac-' || md5(connection:account)), so a repeat is a
--     primary-key conflict rather than a new row;
--   * ON CONFLICT DO NOTHING covers both that and the
--     (connection_id, external_account_id) unique, so a half-applied attempt
--     converges instead of failing — and an account the user has since
--     switched out of the totals keeps include_in_totals = false;
--   * the NOT EXISTS check means that once 0016 is recorded, nothing is
--     inserted at all, so an account row the user deleted is not resurrected
--     and accounts the running sync has since added are left alone.
INSERT INTO "bank_accounts" (
    "id", "connection_id", "external_account_id", "mask", "currency",
    "include_in_totals", "last_balance", "last_balance_at", "balance_type",
    "created_at", "updated_at"
)
SELECT
    'bac-' || md5(c."id" || ':' || account."value"),
    c."id",
    account."value",
    NULLIF(c."metadata"->'accountLabels'->>((account."position" - 1)::int), 'account'),
    c."metadata"->'balances'->account."value"->>'currency',
    true,
    NULLIF(c."metadata"->'balances'->account."value"->>'amount', '')::numeric,
    NULLIF(c."metadata"->'balances'->account."value"->>'at', '')::timestamp,
    c."metadata"->'balances'->account."value"->>'type',
    c."created_at",
    CURRENT_TIMESTAMP
FROM "integration_connections" c
CROSS JOIN LATERAL jsonb_array_elements_text(c."metadata"->'accounts')
    WITH ORDINALITY AS account("value", "position")
WHERE c."provider" = 'gocardless'
  AND jsonb_typeof(c."metadata"->'accounts') = 'array'
  AND NOT EXISTS (
      SELECT 1 FROM "_prisma_migrations" m
       WHERE m."migration_name" = '0016_multi_bank_connections'
         AND m."finished_at" IS NOT NULL
         AND m."rolled_back_at" IS NULL
  )
ON CONFLICT DO NOTHING;



-- =====================================================================
-- STEP 9.  Record the migration in "_prisma_migrations".
--
-- Columns and values match exactly what scripts/apply-migrations.ts writes
-- on success:
--   (id, checksum, finished_at, migration_name, logs, started_at,
--    applied_steps_count) = (uuid, sha256-hex, now(), name, NULL, now(), 1)
-- rolled_back_at is left NULL.
--
-- The INSERT is a no-op if a row for 0016 already exists, so an existing
-- record is never duplicated.
-- =====================================================================

INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text,
       'f92b0da30a50ac653bd603aa512c1a5fdb3fdd9227cb02218b503ae4d72b5fb8',
       now(), '0016_multi_bank_connections', NULL, NULL, now(), 1
 WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '0016_multi_bank_connections'
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

-- Check 1: migration history. Expect 16 rows, 0016 present with a
-- finished_at timestamp and no rolled_back_at.
SELECT "migration_name",
       "checksum",
       "finished_at",
       "rolled_back_at",
       "applied_steps_count"
  FROM "_prisma_migrations"
 ORDER BY "migration_name";

-- Check 2: the connections themselves, and the accounts now attached to
-- each. No secrets are selected. Every bank (gocardless/plaid) row should
-- show an external_id; a bank row with external_id NULL is the one thing
-- here worth a message — see the README.
SELECT c."provider",
       c."id"               AS "connection_id",
       c."external_id",
       c."display_name",
       c."institution_name",
       c."status",
       (SELECT count(*) FROM "bank_accounts" b WHERE b."connection_id" = c."id") AS "bank_accounts",
       jsonb_array_length(CASE WHEN jsonb_typeof(c."metadata"->'accounts') = 'array'
                               THEN c."metadata"->'accounts' END)                AS "accounts_in_metadata"
  FROM "integration_connections" c
 ORDER BY c."provider", c."created_at";

-- Check 3: the index state on integration_connections after the swap.
-- Expect the two new unique indexes (one of them partial, with
-- "WHERE (external_id IS NULL)" in its definition), the lookup index, and
-- NO integration_connections_workspace_id_provider_key.
SELECT "indexname", "indexdef"
  FROM pg_indexes
 WHERE "schemaname" = current_schema()
   AND "tablename" IN ('integration_connections', 'bank_accounts')
 ORDER BY "tablename", "indexname";

-- Check 4: the summary. Every row should read 'OK'.
WITH checks (sort_order, check_name, expected, actual) AS (
    VALUES
        (1, 'migration 0016_multi_bank_connections recorded'::text, 'yes'::text,
            (SELECT CASE WHEN count(*) > 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0016_multi_bank_connections'
                AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)),
        (2, 'recorded checksum matches the repo file', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0016_multi_bank_connections'
                AND "checksum" = 'f92b0da30a50ac653bd603aa512c1a5fdb3fdd9227cb02218b503ae4d72b5fb8')),
        (3, 'no failed/rolled-back migration rows', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL)),
        (4, 'full migration history present', '16 of 16',
            (SELECT count(DISTINCT "migration_name") || ' of 16'
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
                AND "migration_name" IN (
                    '0001_init', '0002_conversations', '0003_assumptions', '0004_invoices',
                    '0005_invoice_direction', '0006_notifications', '0007_saas',
                    '0008_integrations', '0009_performance_indexes', '0010_ai_provider_groq',
                    '0011_business_profile', '0012_default_ai_provider_groq',
                    '0013_help_messages', '0014_workspaces', '0015_extraction_telemetry',
                    '0016_multi_bank_connections'))),
        (5, 'table bank_accounts exists', 'yes',
            (SELECT CASE WHEN to_regclass('"bank_accounts"') IS NOT NULL THEN 'yes' ELSE 'NO' END::text)),
        (6, 'bank_accounts has its 12 columns', '12 of 12',
            (SELECT count(*) || ' of 12'
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'bank_accounts'
                AND column_name IN ('id', 'connection_id', 'external_account_id', 'name',
                                    'mask', 'currency', 'include_in_totals', 'last_balance',
                                    'last_balance_at', 'balance_type', 'created_at', 'updated_at'))),
        (7, 'integration_connections has the 4 new columns', '4 of 4',
            (SELECT count(*) || ' of 4'
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'integration_connections'
                AND column_name IN ('external_id', 'display_name',
                                    'institution_name', 'institution_logo'))),
        (8, 'old provider-wide unique is gone', 'gone',
            (SELECT CASE WHEN to_regclass('"integration_connections_workspace_id_provider_key"') IS NULL
                         THEN 'gone' ELSE 'STILL THERE' END::text)),
        (9, 'UNIQUE (workspace_id, provider, external_id) exists', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_index i
               JOIN pg_class ix ON ix.oid = i."indexrelid"
              WHERE ix."relname" = 'integration_connections_workspace_id_provider_external_id_key'
                AND i."indisunique" AND i."indpred" IS NULL)),
        (10, 'PARTIAL unique for the external_id IS NULL case exists', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_index i
               JOIN pg_class ix ON ix.oid = i."indexrelid"
              WHERE ix."relname" = 'integration_connections_workspace_provider_null_key'
                AND i."indisunique" AND i."indpred" IS NOT NULL)),
        (11, 'lookup index (workspace_id, provider) exists', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_index i
               JOIN pg_class ix ON ix.oid = i."indexrelid"
              WHERE ix."relname" = 'integration_connections_workspace_id_provider_idx'
                AND NOT i."indisunique")),
        (12, 'bank_accounts unique (connection_id, external_account_id)', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_index i
               JOIN pg_class ix ON ix.oid = i."indexrelid"
              WHERE ix."relname" = 'bank_accounts_connection_id_external_account_id_key'
                AND i."indisunique")),
        (13, 'bank_accounts FK cascades from its connection', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_constraint
              WHERE "conname" = 'bank_accounts_connection_id_fkey'
                AND "contype" = 'f'
                AND "confdeltype" = 'c'
                AND "confupdtype" = 'c')),
        (14, 'every bank connection got an external_id', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' without one' END::text
               FROM "integration_connections"
              WHERE "provider" IN ('gocardless', 'plaid')
                AND "external_id" IS NULL)),
        (15, 'every GoCardless metadata account has a bank_accounts row', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' missing' END::text
               FROM "integration_connections" c
               CROSS JOIN LATERAL jsonb_array_elements_text(c."metadata"->'accounts')
                    AS account("value")
              WHERE c."provider" = 'gocardless'
                AND jsonb_typeof(c."metadata"->'accounts') = 'array'
                AND NOT EXISTS (
                    SELECT 1 FROM "bank_accounts" b
                     WHERE b."connection_id" = c."id"
                       AND b."external_account_id" = account."value"))),
        (16, 'no duplicate bank_accounts row for one account', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' duplicated' END::text
               FROM (SELECT "connection_id", "external_account_id"
                       FROM "bank_accounts"
                      GROUP BY 1, 2 HAVING count(*) > 1) d)),
        (17, 'bank_accounts rows all point at a live connection', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' orphaned' END::text
               FROM "bank_accounts" b
              WHERE NOT EXISTS (SELECT 1 FROM "integration_connections" c
                                 WHERE c."id" = b."connection_id"))),
        (18, 'transaction dedupe index still in place', 'yes',
            (SELECT CASE WHEN to_regclass('"transactions_workspace_id_hash_key"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (19, 'no duplicate transaction fingerprints', 'yes',
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
