-- =====================================================================
-- apply-pending-migrations.sql
--
-- Applies the three pending Prisma migrations to the ai-finance-copilot
-- production database and records them in "_prisma_migrations" so that a
-- later `npm run db:apply` sees them as already applied.
--
--   0013_help_messages          sha256 c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d
--   0014_workspaces             sha256 0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e
--   0015_extraction_telemetry   sha256 c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f
--
-- The checksums above are sha256 (hex) of the exact bytes of each
-- prisma/migrations/<name>/migration.sql file, which is precisely how
-- scripts/apply-migrations.ts computes them.
--
-- HOW TO RUN: paste this entire file into the Supabase SQL Editor
-- (New query) and press Run. See README.md next to this file.
--
-- SAFETY PROPERTIES
--   * Everything runs inside ONE transaction. If any statement fails,
--     the whole thing rolls back and the database is untouched.
--   * Safe to run more than once. Every statement is idempotent, and the
--     two rows-seeding INSERTs in 0014 are additionally skipped if 0014
--     is already recorded as applied.
--   * The SQL bodies are byte-for-byte faithful to the migration files
--     except for added idempotency guards (IF NOT EXISTS / ON CONFLICT
--     DO NOTHING / WHERE workspace_id IS NULL). No semantics change on a
--     first, clean application.
-- =====================================================================

BEGIN;

-- Supabase's SQL Editor role has a short statement timeout; 0014 rewrites
-- indexes on every business table, so raise it for this transaction only.
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
-- STEP 0b.  Baseline 0001..0012 if the table was just created.
--
-- Why: if "_prisma_migrations" did not exist, the database schema was
-- created by `prisma db push`. Recording only 0013..0015 would leave
-- 0001..0012 looking "pending", and the next `npm run db:apply` would
-- try to re-run 0001_init and fail with "type TransactionType already
-- exists". Marking them applied is the same thing
-- `prisma migrate resolve --applied` does.
--
-- This only runs when the table is completely empty. If it already has
-- any rows, the database is genuinely migration-managed and 0001..0012
-- are already recorded.
-- ---------------------------------------------------------------------

DO $baseline$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations") THEN
        RAISE NOTICE 'No migration history found: baselining 0001..0012 as already applied.';

        INSERT INTO "_prisma_migrations"
            ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
        VALUES
            (gen_random_uuid()::text, '332fe85d68cc2b7f59e185a80d59f0ab77a3190731c9bd04198c8c12ec9670d8', now(), '0001_init',                    'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e039b143a3efcd37cd5510da397e5c9c9257c88e47a2b9413f827a07a57e58de', now(), '0002_conversations',           'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f13fdae0cab023db0aa497a18c3806e93dc8b0cd0791f8a3d3efdb137c0c572c', now(), '0003_assumptions',             'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '173b3ba227e28f44e7edfb84717f486e51a5479f9f75593db47515794a6c371a', now(), '0004_invoices',                'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'a561ec34107a955ddcf90641fbf6c1e4046cb93bf5389c402704757e34a87aef', now(), '0005_invoice_direction',       'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3a1ec7964d65c7cd22dbcd8c10978d44e7401a234cbccf728944a0d7c579130e', now(), '0006_notifications',           'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '16646d546727f9682c96010e1b4b2363e190cfa152cd807ca70c42f44d1614c7', now(), '0007_saas',                    'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e0ef73f1d3051871ff83d759b1c98784eeec39175623c2e4edd6c5beec91b824', now(), '0008_integrations',            'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '35a31eb5a75dec76d5e2973b75df8d3d1f5d0aa5b91fff1e0318cbef4cc5c633', now(), '0009_performance_indexes',     'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3d335be70a6bb0bc7903e2fe6810b75c3dec1e2e6a18c365e170b28907683d7c', now(), '0010_ai_provider_groq',        'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6c568731d02e58f11fadd7303584610fe1ad72a2c51b64e17ddbc3f91a098337', now(), '0011_business_profile',        'baselined by apply-pending-migrations.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'd0497dffcd8646003887e8eb6ccc0a480460eecb97beca6e70b8d258b346a84f', now(), '0012_default_ai_provider_groq', 'baselined by apply-pending-migrations.sql', NULL, now(), 1);
    END IF;
END
$baseline$;


-- ---------------------------------------------------------------------
-- STEP 0c.  Clear out any failed / rolled-back attempts for the three
-- migrations we are about to apply. scripts/apply-migrations.ts refuses
-- to run (throws) when it finds such a row, so removing them here keeps
-- `npm run db:apply` usable afterwards.
-- ---------------------------------------------------------------------

DELETE FROM "_prisma_migrations"
 WHERE "migration_name" IN ('0013_help_messages', '0014_workspaces', '0015_extraction_telemetry')
   AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL);


-- ---------------------------------------------------------------------
-- STEP 0d.  Tell the operator what is about to happen.
-- ---------------------------------------------------------------------

DO $preflight$
DECLARE
    v_name text;
    v_any  boolean := false;
BEGIN
    FOR v_name IN
        SELECT m."migration_name"
          FROM "_prisma_migrations" m
         WHERE m."migration_name" IN ('0013_help_messages', '0014_workspaces', '0015_extraction_telemetry')
           AND m."finished_at" IS NOT NULL
           AND m."rolled_back_at" IS NULL
         ORDER BY 1
    LOOP
        RAISE NOTICE '% is already recorded as applied; its statements are idempotent and will be no-ops.', v_name;
        v_any := true;
    END LOOP;

    IF NOT v_any THEN
        RAISE NOTICE 'None of 0013/0014/0015 are recorded yet: applying all three.';
    END IF;
END
$preflight$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0013_help_messages
-- sha256 c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d
--
-- Help-agent chat: one lightweight thread per user, separate from the
-- finance copilot's conversations. Reuses the existing "ChatRole" enum.
-- =====================================================================
-- =====================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "help_messages" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "help_messages_user_id_created_at_idx" ON "help_messages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "help_messages" DROP CONSTRAINT IF EXISTS "help_messages_user_id_fkey";
ALTER TABLE "help_messages" ADD CONSTRAINT "help_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0014_workspaces
-- sha256 0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e
--
-- Multi-user shared workspaces. Every business row moves from per-user to
-- per-workspace scope. The migration is additive and reversible in spirit:
-- user_id columns are KEPT everywhere (they now mean "who created this row"),
-- so rolling back the application code only requires the old columns, which
-- remain intact and correctly populated.
--
-- Plan:
--   1. New enum + tables (workspaces, workspace_members, workspace_invitations,
--      audit_logs).
--   2. One personal workspace per existing profile (deterministic ids:
--      'ws-<userId>' / 'wsm-<userId>') with the profile as OWNER.
--   3. Add workspace_id to every business table, backfill from user_id,
--      then make NOT NULL and add the FK.
--   4. Move unique constraints/indexes from user_id to workspace_id.
--   5. Billing moves to workspace scope: subscriptions/usage_records get
--      workspace_id, user_id becomes nullable (informational).
-- =====================================================================
-- =====================================================================

-- ---------------------------------------------------------------- 1. types

-- CREATE TYPE has no IF NOT EXISTS form, hence the guard.
DO $wsrole$
BEGIN
    IF to_regtype('"WorkspaceRole"') IS NULL THEN
        CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
    END IF;
END
$wsrole$;

-- New value can't be used inside this transaction, and isn't.
-- (PostgreSQL 12+ permits ALTER TYPE ... ADD VALUE inside a transaction
-- block as long as the new value is not referenced before COMMIT.)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORKSPACE';

-- --------------------------------------------------------------- 2. tables

CREATE TABLE IF NOT EXISTS "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workspace_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "permissions" JSONB,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_members_workspace_id_user_id_key"
    ON "workspace_members"("workspace_id", "user_id");
CREATE INDEX IF NOT EXISTS "workspace_members_user_id_idx" ON "workspace_members"("user_id");

ALTER TABLE "workspace_members" DROP CONSTRAINT IF EXISTS "workspace_members_workspace_id_fkey";
ALTER TABLE "workspace_members"
    ADD CONSTRAINT "workspace_members_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" DROP CONSTRAINT IF EXISTS "workspace_members_user_id_fkey";
ALTER TABLE "workspace_members"
    ADD CONSTRAINT "workspace_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "workspace_invitations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "invited_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_invitations_token_hash_key"
    ON "workspace_invitations"("token_hash");
CREATE INDEX IF NOT EXISTS "workspace_invitations_workspace_id_created_at_idx"
    ON "workspace_invitations"("workspace_id", "created_at" DESC);

ALTER TABLE "workspace_invitations" DROP CONSTRAINT IF EXISTS "workspace_invitations_workspace_id_fkey";
ALTER TABLE "workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" DROP CONSTRAINT IF EXISTS "workspace_invitations_invited_by_id_fkey";
ALTER TABLE "workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_workspace_id_created_at_idx"
    ON "audit_logs"("workspace_id", "created_at" DESC);

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_workspace_id_fkey";
ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_user_id_fkey";
ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------- 3. personal workspace per profile
--
-- These two INSERTs are the only statements in 0014 that create rows, so
-- they are the only ones that must not run a second time. They are
-- guarded twice:
--   * skipped entirely if 0014 is already recorded as applied (otherwise
--     a profile that signed up after 0014 would get a stray extra
--     personal workspace), and
--   * ON CONFLICT DO NOTHING, so a partially applied 0014 converges
--     instead of failing on workspaces_pkey.

INSERT INTO "workspaces" ("id", "name", "currency", "created_at", "updated_at")
SELECT
    'ws-' || p."id"::text,
    COALESCE(NULLIF(p."full_name", ''), split_part(p."email", '@', 1)),
    p."currency",
    p."created_at",
    CURRENT_TIMESTAMP
FROM "profiles" p
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" m
     WHERE m."migration_name" = '0014_workspaces'
       AND m."finished_at" IS NOT NULL
       AND m."rolled_back_at" IS NULL
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "workspace_members" ("id", "workspace_id", "user_id", "role", "joined_at")
SELECT
    'wsm-' || p."id"::text,
    'ws-' || p."id"::text,
    p."id",
    'OWNER',
    p."created_at"
FROM "profiles" p
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" m
     WHERE m."migration_name" = '0014_workspaces'
       AND m."finished_at" IS NOT NULL
       AND m."rolled_back_at" IS NULL
)
ON CONFLICT ("id") DO NOTHING;

-- ------------------------------------- 4. business tables -> workspace_id
-- Same recipe per table: add column, backfill from the creator's personal
-- workspace, lock down, index.
--
-- The backfill UPDATEs carry an extra `WHERE "workspace_id" IS NULL`. On a
-- clean application the column has just been added so every row is NULL and
-- the effect is identical; on a re-run it prevents rows that have since been
-- moved to a shared workspace from being yanked back to a personal one.

-- transactions
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "transactions" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "transactions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_workspace_id_fkey";
ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "transactions_user_id_hash_key";
DROP INDEX IF EXISTS "transactions_user_id_date_idx";
DROP INDEX IF EXISTS "transactions_user_id_category_id_idx";
DROP INDEX IF EXISTS "transactions_user_id_import_batch_id_idx";
DROP INDEX IF EXISTS "transactions_user_id_type_date_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_workspace_id_hash_key" ON "transactions"("workspace_id", "hash");
CREATE INDEX IF NOT EXISTS "transactions_workspace_id_date_idx" ON "transactions"("workspace_id", "date" DESC);
CREATE INDEX IF NOT EXISTS "transactions_workspace_id_category_id_idx" ON "transactions"("workspace_id", "category_id");
CREATE INDEX IF NOT EXISTS "transactions_workspace_id_import_batch_id_idx" ON "transactions"("workspace_id", "import_batch_id");
CREATE INDEX IF NOT EXISTS "transactions_workspace_id_type_date_idx" ON "transactions"("workspace_id", "type", "date" DESC);

-- categories
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "categories" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "categories" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_workspace_id_fkey";
ALTER TABLE "categories"
    ADD CONSTRAINT "categories_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "categories_user_id_name_key";
DROP INDEX IF EXISTS "categories_user_id_type_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "categories_workspace_id_name_key" ON "categories"("workspace_id", "name");
CREATE INDEX IF NOT EXISTS "categories_workspace_id_type_idx" ON "categories"("workspace_id", "type");

-- category_rules
ALTER TABLE "category_rules" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "category_rules" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "category_rules" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "category_rules" DROP CONSTRAINT IF EXISTS "category_rules_workspace_id_fkey";
ALTER TABLE "category_rules"
    ADD CONSTRAINT "category_rules_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "category_rules_user_id_pattern_key";
DROP INDEX IF EXISTS "category_rules_user_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "category_rules_workspace_id_pattern_key" ON "category_rules"("workspace_id", "pattern");
CREATE INDEX IF NOT EXISTS "category_rules_workspace_id_idx" ON "category_rules"("workspace_id");

-- import_batches
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "import_batches" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "import_batches" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "import_batches" DROP CONSTRAINT IF EXISTS "import_batches_workspace_id_fkey";
ALTER TABLE "import_batches"
    ADD CONSTRAINT "import_batches_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "import_batches_user_id_created_at_idx";
CREATE INDEX IF NOT EXISTS "import_batches_workspace_id_created_at_idx"
    ON "import_batches"("workspace_id", "created_at" DESC);

-- invoices
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "invoices" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "invoices" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_workspace_id_fkey";
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "invoices_user_id_status_idx";
DROP INDEX IF EXISTS "invoices_user_id_due_date_idx";
DROP INDEX IF EXISTS "invoices_user_id_created_at_idx";
DROP INDEX IF EXISTS "invoices_user_id_external_ref_idx";
DROP INDEX IF EXISTS "invoices_user_id_direction_status_idx";
CREATE INDEX IF NOT EXISTS "invoices_workspace_id_status_idx" ON "invoices"("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "invoices_workspace_id_due_date_idx" ON "invoices"("workspace_id", "due_date");
CREATE INDEX IF NOT EXISTS "invoices_workspace_id_created_at_idx" ON "invoices"("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "invoices_workspace_id_external_ref_idx" ON "invoices"("workspace_id", "external_ref");
CREATE INDEX IF NOT EXISTS "invoices_workspace_id_direction_status_idx"
    ON "invoices"("workspace_id", "direction", "status");

-- assumptions
ALTER TABLE "assumptions" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "assumptions" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "assumptions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "assumptions" DROP CONSTRAINT IF EXISTS "assumptions_workspace_id_fkey";
ALTER TABLE "assumptions"
    ADD CONSTRAINT "assumptions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "assumptions_user_id_idx";
CREATE INDEX IF NOT EXISTS "assumptions_workspace_id_idx" ON "assumptions"("workspace_id");

-- conversations (chat_messages stay keyed by conversation_id + author user_id)
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "conversations" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "conversations" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_workspace_id_fkey";
ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "conversations_user_id_updated_at_idx";
CREATE INDEX IF NOT EXISTS "conversations_workspace_id_updated_at_idx"
    ON "conversations"("workspace_id", "updated_at" DESC);

-- budgets
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "budgets" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "budgets" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "budgets_workspace_id_fkey";
ALTER TABLE "budgets"
    ADD CONSTRAINT "budgets_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "budgets_user_id_category_month_year_key";
CREATE UNIQUE INDEX IF NOT EXISTS "budgets_workspace_id_category_month_year_key"
    ON "budgets"("workspace_id", "category", "month", "year");

-- integration_connections (user_id stays: whose OAuth identity connected it)
ALTER TABLE "integration_connections" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "integration_connections" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "integration_connections" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "integration_connections" DROP CONSTRAINT IF EXISTS "integration_connections_workspace_id_fkey";
ALTER TABLE "integration_connections"
    ADD CONSTRAINT "integration_connections_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "integration_connections_user_id_provider_key";
CREATE UNIQUE INDEX IF NOT EXISTS "integration_connections_workspace_id_provider_key"
    ON "integration_connections"("workspace_id", "provider");

-- ------------------------------------------- 5. billing -> workspace scope

-- subscriptions: the workspace owns the plan; user_id becomes informational
-- ("who set up billing") and must no longer cascade-delete the subscription.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "subscriptions" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "subscriptions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_workspace_id_fkey";
ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_workspace_id_key" ON "subscriptions"("workspace_id");
DROP INDEX IF EXISTS "subscriptions_user_id_key";
ALTER TABLE "subscriptions" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_user_id_fkey";
ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- usage_records: quota is consumed by the workspace, not the individual.
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
UPDATE "usage_records" SET "workspace_id" = 'ws-' || "user_id"::text WHERE "workspace_id" IS NULL;
ALTER TABLE "usage_records" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_workspace_id_fkey";
ALTER TABLE "usage_records"
    ADD CONSTRAINT "usage_records_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "usage_records_workspace_id_period_key"
    ON "usage_records"("workspace_id", "period");
DROP INDEX IF EXISTS "usage_records_user_id_period_key";
ALTER TABLE "usage_records" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_user_id_fkey";
ALTER TABLE "usage_records"
    ADD CONSTRAINT "usage_records_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0015_extraction_telemetry
-- sha256 c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f
--
-- Extraction telemetry: which provider/model handled a document, how long it
-- took, why it failed (shown on the review page), arithmetic warnings and
-- per-field confidence for review highlighting. All nullable - existing rows
-- simply have no telemetry.
-- =====================================================================
-- =====================================================================

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "extraction_provider"    TEXT,
  ADD COLUMN IF NOT EXISTS "extraction_model"       TEXT,
  ADD COLUMN IF NOT EXISTS "extraction_duration_ms" INTEGER,
  ADD COLUMN IF NOT EXISTS "extraction_reason"      TEXT,
  ADD COLUMN IF NOT EXISTS "extraction_warnings"    JSONB,
  ADD COLUMN IF NOT EXISTS "extraction_confidence"  JSONB;



-- =====================================================================
-- STEP 9.  Record the three migrations in "_prisma_migrations".
--
-- Columns and values match exactly what scripts/apply-migrations.ts writes
-- on success:
--   (id, checksum, finished_at, migration_name, logs, started_at,
--    applied_steps_count) = (uuid, sha256-hex, now(), name, NULL, now(), 1)
-- rolled_back_at is left NULL.
--
-- Each INSERT is a no-op if a row for that migration already exists, so an
-- existing (possibly older-checksum) record is never duplicated.
-- =====================================================================

INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text,
       'c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d',
       now(), '0013_help_messages', NULL, NULL, now(), 1
 WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '0013_help_messages'
);

INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text,
       '0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e',
       now(), '0014_workspaces', NULL, NULL, now(), 1
 WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '0014_workspaces'
);

INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text,
       'c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f',
       now(), '0015_extraction_telemetry', NULL, NULL, now(), 1
 WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '0015_extraction_telemetry'
);


COMMIT;


-- =====================================================================
-- =====================================================================
-- VERIFICATION (read-only, runs after the COMMIT above)
--
-- If the transaction failed, none of these run and nothing was changed.
-- The Supabase SQL Editor shows the result of the LAST query, which is
-- the summary table in check 3 - read that one first.
-- =====================================================================
-- =====================================================================

-- Check 1: migration history. Expect 15 rows, 0013/0014/0015 present with a
-- finished_at timestamp and no rolled_back_at.
SELECT "migration_name",
       "checksum",
       "finished_at",
       "rolled_back_at",
       "applied_steps_count"
  FROM "_prisma_migrations"
 ORDER BY "migration_name";

-- Check 2: every table that should now carry a workspace_id, and whether it
-- is NOT NULL. Expect 14 rows, all is_nullable = 'NO': workspace_members,
-- workspace_invitations, audit_logs, transactions, categories, category_rules,
-- import_batches, invoices, assumptions, conversations, budgets,
-- integration_connections, subscriptions, usage_records.
SELECT c.table_name,
       c.column_name,
       c.is_nullable
  FROM information_schema.columns c
 WHERE c.table_schema = current_schema()
   AND c.column_name = 'workspace_id'
 ORDER BY c.table_name;

-- Check 3: the summary. Every row should read 'OK'.
WITH checks (sort_order, check_name, expected, actual) AS (
    VALUES
        (1, 'migration 0013_help_messages recorded'::text, 'yes'::text,
            (SELECT CASE WHEN count(*) > 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0013_help_messages'
                AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)),
        (2, 'migration 0014_workspaces recorded', 'yes',
            (SELECT CASE WHEN count(*) > 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0014_workspaces'
                AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)),
        (3, 'migration 0015_extraction_telemetry recorded', 'yes',
            (SELECT CASE WHEN count(*) > 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0015_extraction_telemetry'
                AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)),
        (4, 'checksums match the repo files', 'yes',
            (SELECT CASE WHEN count(*) = 3 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE ("migration_name", "checksum") IN (
                        ('0013_help_messages',        'c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d'),
                        ('0014_workspaces',           '0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e'),
                        ('0015_extraction_telemetry', 'c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f')))),
        (5, 'no failed/rolled-back migration rows', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL)),
        (6, 'table help_messages exists', 'yes',
            (SELECT CASE WHEN to_regclass('"help_messages"') IS NOT NULL THEN 'yes' ELSE 'NO' END::text)),
        (7, 'table workspaces exists', 'yes',
            (SELECT CASE WHEN to_regclass('"workspaces"') IS NOT NULL THEN 'yes' ELSE 'NO' END::text)),
        (8, 'tables workspace_members / invitations / audit_logs exist', 'yes',
            (SELECT CASE WHEN to_regclass('"workspace_members"') IS NOT NULL
                          AND to_regclass('"workspace_invitations"') IS NOT NULL
                          AND to_regclass('"audit_logs"') IS NOT NULL
                     THEN 'yes' ELSE 'NO' END::text)),
        (9, 'enum WorkspaceRole exists', 'yes',
            (SELECT CASE WHEN to_regtype('"WorkspaceRole"') IS NOT NULL THEN 'yes' ELSE 'NO' END::text)),
        (10, 'NotificationType has value WORKSPACE', 'yes',
            (SELECT CASE WHEN 'WORKSPACE' = ANY (enum_range(NULL::"NotificationType")::text[])
                         THEN 'yes' ELSE 'NO' END::text)),
        (11, 'workspace_id columns present and NOT NULL', '14 of 14',
            (SELECT count(*) || ' of 14'
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND column_name = 'workspace_id'
                AND is_nullable = 'NO')),
        (12, 'every profile has a personal workspace', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' missing' END::text
               FROM "profiles" p
              WHERE NOT EXISTS (SELECT 1 FROM "workspaces" w WHERE w."id" = 'ws-' || p."id"::text))),
        (13, 'every profile is an OWNER member', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' missing' END::text
               FROM "profiles" p
              WHERE NOT EXISTS (
                    SELECT 1 FROM "workspace_members" m
                     WHERE m."user_id" = p."id" AND m."role" = 'OWNER'))),
        (14, 'invoices has the 6 extraction telemetry columns', '6 of 6',
            (SELECT count(*) || ' of 6'
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'invoices'
                AND column_name IN ('extraction_provider', 'extraction_model',
                                    'extraction_duration_ms', 'extraction_reason',
                                    'extraction_warnings', 'extraction_confidence'))),
        (15, 'no transactions left without a workspace', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' orphaned' END::text
               FROM "transactions" t
              WHERE NOT EXISTS (SELECT 1 FROM "workspaces" w WHERE w."id" = t."workspace_id")))
)
SELECT sort_order AS "#",
       check_name AS "check",
       expected   AS "expected",
       actual     AS "actual",
       CASE WHEN expected = actual THEN 'OK' ELSE '*** LOOK AT THIS ***' END AS "result"
  FROM checks
 ORDER BY sort_order;
