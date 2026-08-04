-- 0014_workspaces
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

-- ---------------------------------------------------------------- 1. types

CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- New value can't be used inside this transaction, and isn't.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORKSPACE';

-- --------------------------------------------------------------- 2. tables

CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "permissions" JSONB,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key"
    ON "workspace_members"("workspace_id", "user_id");
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

ALTER TABLE "workspace_members"
    ADD CONSTRAINT "workspace_members_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members"
    ADD CONSTRAINT "workspace_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "workspace_invitations" (
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

CREATE UNIQUE INDEX "workspace_invitations_token_hash_key"
    ON "workspace_invitations"("token_hash");
CREATE INDEX "workspace_invitations_workspace_id_created_at_idx"
    ON "workspace_invitations"("workspace_id", "created_at" DESC);

ALTER TABLE "workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_workspace_id_created_at_idx"
    ON "audit_logs"("workspace_id", "created_at" DESC);

ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------- 3. personal workspace per profile

INSERT INTO "workspaces" ("id", "name", "currency", "created_at", "updated_at")
SELECT
    'ws-' || p."id"::text,
    COALESCE(NULLIF(p."full_name", ''), split_part(p."email", '@', 1)),
    p."currency",
    p."created_at",
    CURRENT_TIMESTAMP
FROM "profiles" p;

INSERT INTO "workspace_members" ("id", "workspace_id", "user_id", "role", "joined_at")
SELECT
    'wsm-' || p."id"::text,
    'ws-' || p."id"::text,
    p."id",
    'OWNER',
    p."created_at"
FROM "profiles" p;

-- ------------------------------------- 4. business tables -> workspace_id
-- Same recipe per table: add column, backfill from the creator's personal
-- workspace, lock down, index.

-- transactions
ALTER TABLE "transactions" ADD COLUMN "workspace_id" TEXT;
UPDATE "transactions" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "transactions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "transactions_user_id_hash_key";
DROP INDEX IF EXISTS "transactions_user_id_date_idx";
DROP INDEX IF EXISTS "transactions_user_id_category_id_idx";
DROP INDEX IF EXISTS "transactions_user_id_import_batch_id_idx";
DROP INDEX IF EXISTS "transactions_user_id_type_date_idx";
CREATE UNIQUE INDEX "transactions_workspace_id_hash_key" ON "transactions"("workspace_id", "hash");
CREATE INDEX "transactions_workspace_id_date_idx" ON "transactions"("workspace_id", "date" DESC);
CREATE INDEX "transactions_workspace_id_category_id_idx" ON "transactions"("workspace_id", "category_id");
CREATE INDEX "transactions_workspace_id_import_batch_id_idx" ON "transactions"("workspace_id", "import_batch_id");
CREATE INDEX "transactions_workspace_id_type_date_idx" ON "transactions"("workspace_id", "type", "date" DESC);

-- categories
ALTER TABLE "categories" ADD COLUMN "workspace_id" TEXT;
UPDATE "categories" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "categories" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "categories"
    ADD CONSTRAINT "categories_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "categories_user_id_name_key";
DROP INDEX IF EXISTS "categories_user_id_type_idx";
CREATE UNIQUE INDEX "categories_workspace_id_name_key" ON "categories"("workspace_id", "name");
CREATE INDEX "categories_workspace_id_type_idx" ON "categories"("workspace_id", "type");

-- category_rules
ALTER TABLE "category_rules" ADD COLUMN "workspace_id" TEXT;
UPDATE "category_rules" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "category_rules" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "category_rules"
    ADD CONSTRAINT "category_rules_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "category_rules_user_id_pattern_key";
DROP INDEX IF EXISTS "category_rules_user_id_idx";
CREATE UNIQUE INDEX "category_rules_workspace_id_pattern_key" ON "category_rules"("workspace_id", "pattern");
CREATE INDEX "category_rules_workspace_id_idx" ON "category_rules"("workspace_id");

-- import_batches
ALTER TABLE "import_batches" ADD COLUMN "workspace_id" TEXT;
UPDATE "import_batches" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "import_batches" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "import_batches"
    ADD CONSTRAINT "import_batches_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "import_batches_user_id_created_at_idx";
CREATE INDEX "import_batches_workspace_id_created_at_idx"
    ON "import_batches"("workspace_id", "created_at" DESC);

-- invoices
ALTER TABLE "invoices" ADD COLUMN "workspace_id" TEXT;
UPDATE "invoices" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "invoices" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "invoices_user_id_status_idx";
DROP INDEX IF EXISTS "invoices_user_id_due_date_idx";
DROP INDEX IF EXISTS "invoices_user_id_created_at_idx";
DROP INDEX IF EXISTS "invoices_user_id_external_ref_idx";
DROP INDEX IF EXISTS "invoices_user_id_direction_status_idx";
CREATE INDEX "invoices_workspace_id_status_idx" ON "invoices"("workspace_id", "status");
CREATE INDEX "invoices_workspace_id_due_date_idx" ON "invoices"("workspace_id", "due_date");
CREATE INDEX "invoices_workspace_id_created_at_idx" ON "invoices"("workspace_id", "created_at" DESC);
CREATE INDEX "invoices_workspace_id_external_ref_idx" ON "invoices"("workspace_id", "external_ref");
CREATE INDEX "invoices_workspace_id_direction_status_idx"
    ON "invoices"("workspace_id", "direction", "status");

-- assumptions
ALTER TABLE "assumptions" ADD COLUMN "workspace_id" TEXT;
UPDATE "assumptions" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "assumptions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "assumptions"
    ADD CONSTRAINT "assumptions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "assumptions_user_id_idx";
CREATE INDEX "assumptions_workspace_id_idx" ON "assumptions"("workspace_id");

-- conversations (chat_messages stay keyed by conversation_id + author user_id)
ALTER TABLE "conversations" ADD COLUMN "workspace_id" TEXT;
UPDATE "conversations" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "conversations" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "conversations_user_id_updated_at_idx";
CREATE INDEX "conversations_workspace_id_updated_at_idx"
    ON "conversations"("workspace_id", "updated_at" DESC);

-- budgets
ALTER TABLE "budgets" ADD COLUMN "workspace_id" TEXT;
UPDATE "budgets" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "budgets" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "budgets"
    ADD CONSTRAINT "budgets_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "budgets_user_id_category_month_year_key";
CREATE UNIQUE INDEX "budgets_workspace_id_category_month_year_key"
    ON "budgets"("workspace_id", "category", "month", "year");

-- integration_connections (user_id stays: whose OAuth identity connected it)
ALTER TABLE "integration_connections" ADD COLUMN "workspace_id" TEXT;
UPDATE "integration_connections" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "integration_connections" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "integration_connections"
    ADD CONSTRAINT "integration_connections_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "integration_connections_user_id_provider_key";
CREATE UNIQUE INDEX "integration_connections_workspace_id_provider_key"
    ON "integration_connections"("workspace_id", "provider");

-- ------------------------------------------- 5. billing -> workspace scope

-- subscriptions: the workspace owns the plan; user_id becomes informational
-- ("who set up billing") and must no longer cascade-delete the subscription.
ALTER TABLE "subscriptions" ADD COLUMN "workspace_id" TEXT;
UPDATE "subscriptions" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "subscriptions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "subscriptions_workspace_id_key" ON "subscriptions"("workspace_id");
DROP INDEX IF EXISTS "subscriptions_user_id_key";
ALTER TABLE "subscriptions" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_user_id_fkey";
ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- usage_records: quota is consumed by the workspace, not the individual.
ALTER TABLE "usage_records" ADD COLUMN "workspace_id" TEXT;
UPDATE "usage_records" SET "workspace_id" = 'ws-' || "user_id"::text;
ALTER TABLE "usage_records" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "usage_records"
    ADD CONSTRAINT "usage_records_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "usage_records_workspace_id_period_key"
    ON "usage_records"("workspace_id", "period");
DROP INDEX IF EXISTS "usage_records_user_id_period_key";
ALTER TABLE "usage_records" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_user_id_fkey";
ALTER TABLE "usage_records"
    ADD CONSTRAINT "usage_records_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
