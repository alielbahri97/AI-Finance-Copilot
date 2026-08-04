-- 0017_workspace_editions
-- Ships two editions of Ballast from one codebase: the existing Business
-- edition and a new Personal edition for individuals.
--
-- Plan:
--   1. Give every workspace a type (BUSINESS | PERSONAL). The default is
--      BUSINESS, so every workspace that exists today keeps exactly the
--      product it has been using and no backfill is needed.
--   2. Grow the PlanId enum with the two Personal paid tiers (PLUS,
--      PREMIUM). FREE is shared between the editions; its limits differ per
--      edition and that lives in code, not here. The Business tiers
--      (PRO, BUSINESS, ENTERPRISE) are untouched.
--   3. Make the pre-existing but unused budgets table usable: link it to a
--      category by id (it only had the name) and add the rollover switch.
--   4. Add savings_goals and savings_contributions for the Personal
--      edition's goal tracking.
--
-- Nothing here changes existing rows' meaning. The only data statement is
-- the budgets.category_id backfill, which resolves a name that is already
-- stored to the category it names — and budgets has no writer in the
-- application before this migration, so in practice it touches nothing.
--
-- ALTER TYPE ... ADD VALUE runs fine inside a transaction on PostgreSQL 12+
-- as long as the new labels are not used before the commit. They are not:
-- no statement below mentions PLUS or PREMIUM.

-- --------------------------------------------------- 1. the workspace type

CREATE TYPE "WorkspaceType" AS ENUM ('BUSINESS', 'PERSONAL');

-- DEFAULT 'BUSINESS' is what makes this safe on a live database: the column
-- is NOT NULL from the start and every existing workspace is stamped
-- BUSINESS, which is the edition they were created in.
ALTER TABLE "workspaces"
  ADD COLUMN "type" "WorkspaceType" NOT NULL DEFAULT 'BUSINESS';

-- Edition-wide queries (admin KPIs, per-edition counts) filter on it.
CREATE INDEX "workspaces_type_idx" ON "workspaces"("type");

-- ------------------------------------------------- 2. Personal plan tiers

ALTER TYPE "PlanId" ADD VALUE 'PLUS';
ALTER TYPE "PlanId" ADD VALUE 'PREMIUM';

-- ------------------------------------------------------------ 3. budgets

ALTER TABLE "budgets"
  ADD COLUMN "category_id" TEXT,
  ADD COLUMN "rollover"    BOOLEAN NOT NULL DEFAULT false;

-- budgets.category holds the category NAME and stays the uniqueness key.
-- Resolve it to an id where a category of that name exists in the same
-- workspace; categories are unique on (workspace_id, name), so this cannot
-- match more than one row.
UPDATE "budgets" b
   SET "category_id" = c."id"
  FROM "categories" c
 WHERE c."workspace_id" = b."workspace_id"
   AND c."name" = b."category"
   AND b."category_id" IS NULL;

-- A budget for a category that no longer exists is meaningless, so it goes
-- with the category.
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "budgets_workspace_id_year_month_idx"
    ON "budgets"("workspace_id", "year", "month");

-- ------------------------------------------------------- 4. savings goals

CREATE TABLE "savings_goals" (
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

CREATE UNIQUE INDEX "savings_goals_workspace_id_name_key"
    ON "savings_goals"("workspace_id", "name");

CREATE INDEX "savings_goals_workspace_id_created_at_idx"
    ON "savings_goals"("workspace_id", "created_at" DESC);

ALTER TABLE "savings_goals"
    ADD CONSTRAINT "savings_goals_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "savings_goals"
    ADD CONSTRAINT "savings_goals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The links are conveniences, not the goal's identity: losing the category
-- or the account must not delete the goal or its history.
ALTER TABLE "savings_goals"
    ADD CONSTRAINT "savings_goals_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "savings_goals"
    ADD CONSTRAINT "savings_goals_bank_account_id_fkey"
    FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "savings_contributions" (
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
CREATE UNIQUE INDEX "savings_contributions_goal_id_transaction_id_key"
    ON "savings_contributions"("goal_id", "transaction_id");

CREATE INDEX "savings_contributions_goal_id_date_idx"
    ON "savings_contributions"("goal_id", "date" DESC);

ALTER TABLE "savings_contributions"
    ADD CONSTRAINT "savings_contributions_goal_id_fkey"
    FOREIGN KEY ("goal_id") REFERENCES "savings_goals"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
