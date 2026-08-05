-- 0021_forecast_scenarios
-- Named forecast scenarios: group what-if assumptions into "Base case",
-- "Hire in Q4", "Lose the top client", switch between them and compare them
-- on one chart.
--
-- Plan:
--   1. "scenarios" — the names, workspace-scoped like every other business
--      table. A scenario holds no numbers of its own; it is a grouping, and
--      the forecast engine runs unchanged once per scenario. UNIQUE
--      (workspace_id, name) so the switcher never shows the same name twice.
--   2. "assumptions"."scenario_id" — nullable, referencing "scenarios" with
--      ON DELETE CASCADE. NULL *is* the base scenario, not a row waiting to
--      be filled in, which is what makes this migration backfill-free: every
--      assumption that exists today keeps working, unchanged, as part of the
--      base scenario. Deleting a named scenario takes its own assumptions
--      with it and never touches the base ones.
--
-- Additive only: one new table and one nullable column. Nothing is dropped,
-- narrowed, renamed or backfilled, and code that predates this migration
-- never reads any of it.

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "assumptions" ADD COLUMN "scenario_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_workspace_id_name_key" ON "scenarios"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "scenarios_workspace_id_created_at_idx" ON "scenarios"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "assumptions_scenario_id_idx" ON "assumptions"("scenario_id");

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
