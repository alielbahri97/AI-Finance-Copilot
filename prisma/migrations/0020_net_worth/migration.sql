-- 0020_net_worth
-- Net worth tracking for the Personal edition: what a person owns and owes
-- beyond what their banks already report.
--
-- Plan:
--   1. "AssetKind" — ten kinds in one enum, six things owned and four owed.
--      Which side of the balance a kind falls on is derived in the
--      application (src/lib/personal/net-worth.ts) rather than stored, so a
--      row can never claim to be an asset while holding a mortgage's kind.
--   2. "assets" — the holdings themselves, workspace-scoped like every other
--      business table. Deliberately valueless: worth changes, and the
--      history is the feature.
--   3. "asset_valuations" — append-only worth-on-a-date rows. The latest one
--      is the current value; the rest draw the net-worth line. They cascade
--      with their asset, so deleting a holding leaves nothing behind.
--
-- Additive only: one enum and two new tables. Nothing existing is dropped,
-- narrowed, renamed or backfilled, and code that predates this migration
-- never reads any of it.

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('PROPERTY', 'VEHICLE', 'INVESTMENT', 'CRYPTO', 'CASH', 'OTHER_ASSET', 'LOAN', 'MORTGAGE', 'CREDIT_LINE', 'OTHER_LIABILITY');

-- CreateTable
CREATE TABLE "assets" (
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

-- CreateTable
CREATE TABLE "asset_valuations" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_workspace_id_name_key" ON "assets"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "assets_workspace_id_created_at_idx" ON "assets"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "asset_valuations_asset_id_as_of_idx" ON "asset_valuations"("asset_id", "as_of" DESC);

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
