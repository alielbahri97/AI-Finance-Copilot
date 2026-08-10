-- =====================================================================
-- apply-0027.sql
--
-- Applies the one Google Play Billing migration to the
-- ai-finance-copilot production database and records it in
-- "_prisma_migrations" so that a later `npm run db:apply` sees it as
-- already applied.
--
--   0027_play_billing        sha256 d213f127397d5db6cde8488923b60f96bba8294970db00b1f828d1f60bf440bd
--
-- The checksum is sha256 (hex) of the exact bytes of
-- prisma/migrations/0027_play_billing/migration.sql with LF line
-- endings, which is precisely how scripts/apply-migrations.ts computes
-- it on Linux and macOS. See the line-ending note in README.md.
--
-- HOW TO RUN: paste this entire file into the Supabase SQL Editor
-- (New query) and press Run. See README.md next to this file.
--
-- RUN apply-0021-0026.sql FIRST. That is a hard prerequisite, not a
-- preference: STEP 0a below stops with a clear error if round 8 has not
-- been applied, before anything is changed.
--
-- WHEN TO RUN THIS: only when the Play Billing branch
-- (`feat/play-billing`) is about to be deployed. It is deliberately a
-- separate file from apply-0021-0026.sql because 0021..0026 are needed
-- by the feature set being deployed now, and 0027 is needed only by the
-- one after it. Running it early is harmless — every column and table
-- it adds is simply unread by code that does not know about them — but
-- there is no reason to.
--
-- WHAT IT DOES
--   0027  Creates the "PlanSource" enum and "play_purchases", the one
--         row per Google Play purchase token that is the source of
--         truth for the Play side of billing. Adds three columns to
--         "subscriptions": "plan_source" (which payer won resolution),
--         and "stripe_plan"/"stripe_status" (Stripe's own tier and
--         status, kept beside the resolved cache so a complimentary
--         grant written over the top no longer erases the fact that a
--         paid Stripe subscription exists underneath). Backfills all
--         three from the Stripe data already present.
--
-- WHY "play_purchases" ROWS ARE RETIRED RATHER THAN DELETED
--   Play issues a *replacement* purchase token on an upgrade, downgrade
--   or resubscribe, and a refund can still arrive against the old token
--   afterwards. "retired_at" is how a superseded token stays available
--   to apply that refund to. Nothing in this file writes it; it is
--   named here because it explains the shape of the table.
--
-- SAFETY PROPERTIES
--   * Everything runs inside ONE transaction, so a failure rolls the
--     whole thing back and the database is untouched.
--   * Purely additive. One enum, one table, three new columns, and
--     backfills that only ever write into the three columns this
--     migration just created. No existing table is dropped or
--     narrowed, no pre-existing column is renamed or retyped, and no
--     pre-existing column's values are changed. Unlike round 8, this
--     round has no rename in it.
--   * Safe to run more than once. The enum, table, columns, indexes and
--     foreign keys are all guarded, and the three row-writing backfills
--     are skipped once 0027 is recorded as applied *and* additionally
--     scoped so that on a `db:push` database they can only fill a
--     column that is still empty — see STEP 2 for why both guards
--     exist.
--   * The SQL body is faithful to the migration file except for the
--     added existence guards and those backfill scopes. No semantics
--     change on a first, clean application.
--   * Code deployed before this migration keeps working: it simply
--     never reads the new table or columns.
--   * Rolling the *deployment* back past Play Billing is safe. Rolling
--     the *database* back is not, once any real purchase has been
--     recorded, because "play_purchases" is then the only record that
--     a customer is paying Google for something. Roll forward.
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
-- STEP 0a.  Refuse to run on a database that predates round 8.
--
-- Checking the schema rather than the bookkeeping row is deliberate: a
-- `db:push` database has the columns without the history rows, and that
-- is a perfectly fine place to apply this bundle.
--
-- "subscriptions" is the one existing table this migration alters, and
-- the two enums it references live on it already, so their absence is
-- worth naming separately rather than failing halfway through on an
-- ALTER TABLE.
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
    IF to_regclass('"subscriptions"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "subscriptions", which 0007_saas creates. This does not look like an ai-finance-copilot database.';
    END IF;
    IF to_regtype('"PlanId"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing the "PlanId" enum, which 0007_saas creates. The new "stripe_plan" column is of that type, so there is nothing to add it as.';
    END IF;
    IF to_regtype('"SubscriptionStatus"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing the "SubscriptionStatus" enum, which 0007_saas creates. The new "stripe_status" column is of that type, so there is nothing to add it as.';
    END IF;
    IF to_regclass('"pending_bank_connections"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "pending_bank_connections", which 0026_mobile_api adds. Run ops/migrations-bundle/apply-0021-0026.sql first, then run this file.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'profiles'
           AND column_name = 'celebration_seen_at'
    ) THEN
        RAISE EXCEPTION
            'This database is missing "profiles"."celebration_seen_at", which 0025_celebration_seen creates. Run ops/migrations-bundle/apply-0021-0026.sql first, then run this file.';
    END IF;
END
$prereq$;


-- ---------------------------------------------------------------------
-- STEP 0b.  Baseline 0001..0026 if the table was just created.
--
-- Production should already have all twenty-six rows, written by round
-- 8. This block exists for the case where "_prisma_migrations" is
-- missing or empty, where recording only 0027 would leave 0001..0026
-- looking pending and the next `npm run db:apply` would try to re-run
-- 0001_init and fail with "type TransactionType already exists".
--
-- STEP 0a has already established that the 0026 schema is present, so
-- baselining it here is a statement of fact, not a guess.
--
-- The checksums are carried over unchanged from apply-0021-0026.sql.
-- ---------------------------------------------------------------------

DO $baseline$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations") THEN
        RAISE NOTICE 'No migration history found: baselining 0001..0026 as already applied.';

        INSERT INTO "_prisma_migrations"
            ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
        VALUES
            (gen_random_uuid()::text, '332fe85d68cc2b7f59e185a80d59f0ab77a3190731c9bd04198c8c12ec9670d8', now(), '0001_init',                    'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e039b143a3efcd37cd5510da397e5c9c9257c88e47a2b9413f827a07a57e58de', now(), '0002_conversations',           'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f13fdae0cab023db0aa497a18c3806e93dc8b0cd0791f8a3d3efdb137c0c572c', now(), '0003_assumptions',             'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '173b3ba227e28f44e7edfb84717f486e51a5479f9f75593db47515794a6c371a', now(), '0004_invoices',                'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'a561ec34107a955ddcf90641fbf6c1e4046cb93bf5389c402704757e34a87aef', now(), '0005_invoice_direction',       'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3a1ec7964d65c7cd22dbcd8c10978d44e7401a234cbccf728944a0d7c579130e', now(), '0006_notifications',           'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '16646d546727f9682c96010e1b4b2363e190cfa152cd807ca70c42f44d1614c7', now(), '0007_saas',                    'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e0ef73f1d3051871ff83d759b1c98784eeec39175623c2e4edd6c5beec91b824', now(), '0008_integrations',            'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '35a31eb5a75dec76d5e2973b75df8d3d1f5d0aa5b91fff1e0318cbef4cc5c633', now(), '0009_performance_indexes',     'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3d335be70a6bb0bc7903e2fe6810b75c3dec1e2e6a18c365e170b28907683d7c', now(), '0010_ai_provider_groq',        'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6c568731d02e58f11fadd7303584610fe1ad72a2c51b64e17ddbc3f91a098337', now(), '0011_business_profile',        'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'd0497dffcd8646003887e8eb6ccc0a480460eecb97beca6e70b8d258b346a84f', now(), '0012_default_ai_provider_groq', 'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d', now(), '0013_help_messages',           'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e', now(), '0014_workspaces',              'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f', now(), '0015_extraction_telemetry',    'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f92b0da30a50ac653bd603aa512c1a5fdb3fdd9227cb02218b503ae4d72b5fb8', now(), '0016_multi_bank_connections',  'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6ea302ea168c82af6f8f6e627f879809a4ea48cecc2b5c47d83f1ee9422d681d', now(), '0017_workspace_editions',      'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3a670714d7c810ec2a5756b1f1ba214422e79bc2b3f310eb0a80165141079500', now(), '0018_ai_categorization',       'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '0cd9e7a2a9099cc862fa4323ccbe5305921cc52b7f683bc4c912ba98460a2364', now(), '0019_customer_dunning',        'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'ef31084c0ebfb00083cff17b112c6f02216cb5d5a51f72e1cf8ec47d1cc453c7', now(), '0020_net_worth',               'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '2dcc4989b5ae4fb39acb1b776ced3bd11b31033bfea05a621719dee7546e359c', now(), '0021_forecast_scenarios',      'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e721ef88ca59fa6d50aabbd73033478df1dafc05fc7ea091c0206e9606778f3f', now(), '0022_personal_profile',        'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '97b358732783d6d8a91c07ad51a3a19ecc7fabaf31636a80f7783cf273676ff8', now(), '0023_product_tour',            'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '4235fcc9ed6099afb9c2aed7532147665c442242869d2b677366b4544086c6ac', now(), '0024_enterprise_promo',        'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '9662fb1d5d725ca96f26fb2ff7f70731635b0734c6c3ffb6d7f4391ac7628f38', now(), '0025_celebration_seen',        'baselined by apply-0027.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '4970b9fcedd09cf9baa658e38dee149d02f23e91669c6c85799bd79c607f1662', now(), '0026_mobile_api',              'baselined by apply-0027.sql', NULL, now(), 1);
    END IF;
END
$baseline$;


-- ---------------------------------------------------------------------
-- STEP 0c.  Clear out any failed / rolled-back attempt for 0027.
-- scripts/apply-migrations.ts refuses to run (throws) when it finds such
-- a row, so removing it here keeps `npm run db:apply` usable afterwards.
-- ---------------------------------------------------------------------

DELETE FROM "_prisma_migrations"
 WHERE "migration_name" = '0027_play_billing'
   AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL);


-- ---------------------------------------------------------------------
-- STEP 0d.  Tell the operator what is about to happen.
-- ---------------------------------------------------------------------

DO $preflight$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "_prisma_migrations"
         WHERE "migration_name" = '0027_play_billing'
           AND "finished_at" IS NOT NULL
           AND "rolled_back_at" IS NULL
    ) THEN
        RAISE NOTICE '0027_play_billing is already recorded as applied, and will only be re-checked.';
    ELSE
        RAISE NOTICE 'Applying 0027_play_billing.';
    END IF;
END
$preflight$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0027_play_billing
-- sha256 d213f127397d5db6cde8488923b60f96bba8294970db00b1f828d1f60bf440bd
--
-- Google Play Billing: a workspace can now be paid for on the web
-- through Stripe or on a phone through Google Play. Everything here is
-- additive.
-- =====================================================================
-- =====================================================================

-- ------------------------------------------------------------ 1. the enum
--
-- CREATE TYPE has no IF NOT EXISTS form, so guard on to_regtype.
--
-- The five labels are every way a workspace can come to hold a plan:
-- nobody is paying, the local card-free trial, a complimentary grant, a
-- Stripe subscription, a Google Play subscription.

DO $enum_0027$
BEGIN
    IF to_regtype('"PlanSource"') IS NULL THEN
        CREATE TYPE "PlanSource" AS ENUM ('FREE', 'TRIAL', 'COMPLIMENTARY', 'STRIPE', 'GOOGLE_PLAY');
    END IF;
END
$enum_0027$;

-- --------------------------------------- 2. the three subscription columns
--
-- "plan_source" records which payer won resolution, so the billing
-- screen can offer the right management affordance (Stripe's portal, a
-- Play deep link, or neither for a complimentary grant). It is NOT NULL
-- with a DEFAULT, so every existing row gets 'FREE' and the backfills
-- below correct the ones that should say something else. On PostgreSQL
-- a NOT NULL ADD COLUMN with a constant default only touches the
-- catalog: no rewrite, no lock worth naming.
--
-- "stripe_plan" and "stripe_status" hold Stripe's own tier and status
-- beside the resolved cache, so a complimentary grant writing
-- ENTERPRISE over the top no longer erases the fact that a paid Stripe
-- subscription exists underneath. Both are nullable: NULL means "Stripe
-- has never said anything about this workspace".

ALTER TABLE "subscriptions"
    ADD COLUMN IF NOT EXISTS "plan_source" "PlanSource" NOT NULL DEFAULT 'FREE';

ALTER TABLE "subscriptions"
    ADD COLUMN IF NOT EXISTS "stripe_plan" "PlanId";

ALTER TABLE "subscriptions"
    ADD COLUMN IF NOT EXISTS "stripe_status" "SubscriptionStatus";

-- ------------------------------------------------- 3. the three backfills
--
-- These are the only statements in this file that write rows, and they
-- write only into the three columns added immediately above. They are
-- exactly the three UPDATEs in the migration file, with two guards
-- added.
--
-- The outer guard skips them entirely once 0027 is recorded as applied.
-- That matters because the source columns are shared: after Play
-- Billing is live, "plan" and "status" hold whichever payer *won
-- resolution*, so re-running "copy plan into stripe_plan" a month later
-- would record a Play or complimentary tier as Stripe's, inventing a
-- web subscription that does not exist.
--
-- The inner conditions ("stripe_plan" IS NULL, "plan_source" = 'FREE')
-- are the second guard, for a `db:push` database that has the columns
-- but no history row. They change nothing on a first, clean application
-- — every row is NULL and 'FREE' by definition at that point — and they
-- mean the worst this block can ever do is fill in a blank.

DO $backfill_0027$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "_prisma_migrations"
         WHERE "migration_name" = '0027_play_billing'
           AND "finished_at" IS NOT NULL
           AND "rolled_back_at" IS NULL
    ) THEN
        RAISE NOTICE '0027 already applied: leaving "plan_source", "stripe_plan" and "stripe_status" exactly as they are.';
    ELSE
        -- Stripe's own tier and status, for workspaces that have a Stripe
        -- subscription. This is the best available answer and is exact for
        -- every row that is not currently overridden by a complimentary
        -- grant, which is the whole reason the columns exist.
        UPDATE "subscriptions"
           SET "stripe_plan" = "plan",
               "stripe_status" = "status"
         WHERE "stripe_subscription_id" IS NOT NULL
           AND "stripe_plan" IS NULL
           AND "stripe_status" IS NULL;

        -- Workspaces Stripe is currently paying for. PAST_DUE is included
        -- because it is Stripe's grace period and the customer still has
        -- access.
        UPDATE "subscriptions"
           SET "plan_source" = 'STRIPE'
         WHERE "stripe_subscription_id" IS NOT NULL
           AND "plan" <> 'FREE'
           AND "status" IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
           AND "plan_source" = 'FREE';

        -- Workspaces on the local card-free trial, which nobody is paying
        -- for and which is resolved below Stripe and Play.
        UPDATE "subscriptions"
           SET "plan_source" = 'TRIAL'
         WHERE "plan_source" = 'FREE'
           AND "trial_ends_at" IS NOT NULL
           AND "trial_ends_at" > NOW();
    END IF;
END
$backfill_0027$;

-- ------------------------------------------------ 4. the purchase table
--
-- One row per Google Play purchase token, which is what Google
-- identifies a subscription by. "raw" keeps Google's last answer
-- verbatim, because a support question about a purchase is usually a
-- question about what Google said and when.
--
-- Rows are retired ("retired_at") rather than deleted when Play issues
-- a replacement token on an upgrade, downgrade or resubscribe: a refund
-- can still arrive against the old token afterwards, and a deleted row
-- has nothing to apply it to.
--
-- "acknowledged", "acknowledged_at", "ack_attempts" and "ack_error"
-- exist because Google refunds and revokes an unacknowledged purchase
-- three days after it is made, so a failed acknowledgement is a
-- deadline rather than an error, and the daily
-- /api/cron/play-acknowledge sweep needs somewhere to keep score.

CREATE TABLE IF NOT EXISTS "play_purchases" (
    "id" TEXT NOT NULL,
    "purchase_token" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" UUID,
    "product_id" TEXT NOT NULL,
    "base_plan_id" TEXT,
    "plan" "PlanId" NOT NULL,
    "state" TEXT NOT NULL,
    "latest_order_id" TEXT,
    "start_time" TIMESTAMP(3),
    "expiry_time" TIMESTAMP(3),
    "auto_renewing" BOOLEAN NOT NULL DEFAULT false,
    "linked_purchase_token" TEXT,
    "retired_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_at" TIMESTAMP(3),
    "ack_attempts" INTEGER NOT NULL DEFAULT 0,
    "ack_error" TEXT,
    "obfuscated_account_id" TEXT,
    "obfuscated_profile_id" TEXT,
    "last_notification_type" INTEGER,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "play_purchases_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------- 5. the indexes

-- The purchase token is Google's identity for the subscription and the
-- key every endpoint here upserts against, so it has to name exactly
-- one row.
CREATE UNIQUE INDEX IF NOT EXISTS "play_purchases_purchase_token_key"
    ON "play_purchases"("purchase_token");

-- "what is Play currently paying for in this workspace?" — the read on
-- the entitlement path, which excludes retired rows.
CREATE INDEX IF NOT EXISTS "play_purchases_workspace_id_retired_at_idx"
    ON "play_purchases"("workspace_id", "retired_at");

-- Following linkedPurchaseToken back to the row a new token replaces.
CREATE INDEX IF NOT EXISTS "play_purchases_linked_purchase_token_idx"
    ON "play_purchases"("linked_purchase_token");

-- Matching a purchase to the person who made it, by the one-way hash
-- Google echoes back rather than by a Google account id.
CREATE INDEX IF NOT EXISTS "play_purchases_obfuscated_profile_id_idx"
    ON "play_purchases"("obfuscated_profile_id");

-- Sweeping expired purchases.
CREATE INDEX IF NOT EXISTS "play_purchases_expiry_time_idx"
    ON "play_purchases"("expiry_time");

-- ----------------------------------------------------- 6. the foreign keys

DO $fks_0027$
BEGIN
    -- A purchase pays for one workspace and means nothing without it.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'play_purchases_workspace_id_fkey'
           AND conrelid = to_regclass('"play_purchases"')
    ) THEN
        ALTER TABLE "play_purchases"
          ADD CONSTRAINT "play_purchases_workspace_id_fkey"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- SET NULL, not CASCADE: when the payer deletes their account and
    -- the workspace survives because other members are still in it, the
    -- purchase that pays for that workspace has to survive too.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'play_purchases_user_id_fkey'
           AND conrelid = to_regclass('"play_purchases"')
    ) THEN
        ALTER TABLE "play_purchases"
          ADD CONSTRAINT "play_purchases_user_id_fkey"
          FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$fks_0027$;



-- =====================================================================
-- STEP 9.  Record the migration in "_prisma_migrations".
--
-- Columns and values match exactly what scripts/apply-migrations.ts
-- writes on success:
--   (id, checksum, finished_at, migration_name, logs, started_at,
--    applied_steps_count) = (uuid, sha256-hex, now(), name, NULL, now(), 1)
-- rolled_back_at is left NULL.
--
-- The INSERT is a no-op if a row for 0027 already exists, so an
-- existing record is never duplicated.
-- =====================================================================

INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text, v.checksum, now(), v.name, NULL, NULL, now(), 1
  FROM (VALUES
        ('d213f127397d5db6cde8488923b60f96bba8294970db00b1f828d1f60bf440bd', '0027_play_billing')
       ) AS v(checksum, name)
 WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" m WHERE m."migration_name" = v.name
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

-- Check 1: migration history. Expect 27 rows, 0027 present with a
-- finished_at timestamp and no rolled_back_at.
SELECT "migration_name",
       "checksum",
       "finished_at",
       "rolled_back_at",
       "applied_steps_count"
  FROM "_prisma_migrations"
 ORDER BY "migration_name";

-- Check 2: the shape of the new table and of the altered one.
SELECT "table_name", "column_name", "data_type", "udt_name", "is_nullable", "column_default"
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND "table_name" IN ('play_purchases', 'subscriptions')
 ORDER BY "table_name", "ordinal_position";

-- Check 3: where the backfill left every workspace. Right after a first
-- application, 'STRIPE' should be the count of workspaces currently
-- paying through Stripe, 'TRIAL' the count still inside their 14 days,
-- 'FREE' everyone else, and 'GOOGLE_PLAY' zero — nobody can have bought
-- through Play before the app that sells it exists.
SELECT "plan_source",
       count(*)                                              AS "workspaces",
       count(*) FILTER (WHERE "stripe_subscription_id" IS NOT NULL) AS "with_stripe_subscription",
       count(*) FILTER (WHERE "stripe_plan" IS NOT NULL)      AS "with_stripe_plan_recorded"
  FROM "subscriptions"
 GROUP BY "plan_source"
 ORDER BY "plan_source";

-- Check 4: the summary. Every row should read 'OK'.
WITH checks (sort_order, check_name, expected, actual) AS (
    VALUES
        (1, 'the migration is recorded'::text, '1 of 1'::text,
            (SELECT count(DISTINCT "migration_name") || ' of 1'
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
                AND "migration_name" = '0027_play_billing')),
        (2, 'the recorded checksum matches the repo file', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "migration_name" = '0027_play_billing'
                AND "checksum" = 'd213f127397d5db6cde8488923b60f96bba8294970db00b1f828d1f60bf440bd')),
        (3, 'no failed/rolled-back migration rows', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL)),
        (4, 'full migration history present', '27 of 27',
            (SELECT count(DISTINCT "migration_name") || ' of 27'
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
                AND "migration_name" IN (
                    '0001_init', '0002_conversations', '0003_assumptions', '0004_invoices',
                    '0005_invoice_direction', '0006_notifications', '0007_saas',
                    '0008_integrations', '0009_performance_indexes', '0010_ai_provider_groq',
                    '0011_business_profile', '0012_default_ai_provider_groq',
                    '0013_help_messages', '0014_workspaces', '0015_extraction_telemetry',
                    '0016_multi_bank_connections', '0017_workspace_editions',
                    '0018_ai_categorization', '0019_customer_dunning', '0020_net_worth',
                    '0021_forecast_scenarios', '0022_personal_profile', '0023_product_tour',
                    '0024_enterprise_promo', '0025_celebration_seen', '0026_mobile_api',
                    '0027_play_billing'))),

        -- the enum
        (5, 'PlanSource has its five labels', '5',
            (SELECT count(*)::text FROM pg_enum
              WHERE enumtypid = to_regtype('"PlanSource"'))),
        (6, 'PlanSource labels are the five expected ones', '5 of 5',
            (SELECT count(*) || ' of 5' FROM pg_enum
              WHERE enumtypid = to_regtype('"PlanSource"')
                AND enumlabel IN ('FREE', 'TRIAL', 'COMPLIMENTARY', 'STRIPE', 'GOOGLE_PLAY'))),

        -- the three subscription columns
        (7, 'subscriptions.plan_source exists, NOT NULL, defaults to FREE', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'subscriptions' AND column_name = 'plan_source'
                AND is_nullable = 'NO' AND udt_name = 'PlanSource'
                AND column_default LIKE '''FREE''%')),
        (8, 'subscriptions.stripe_plan exists and is a nullable PlanId', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'subscriptions' AND column_name = 'stripe_plan'
                AND is_nullable = 'YES' AND udt_name = 'PlanId')),
        (9, 'subscriptions.stripe_status exists and is a nullable SubscriptionStatus', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'subscriptions' AND column_name = 'stripe_status'
                AND is_nullable = 'YES' AND udt_name = 'SubscriptionStatus')),

        -- the backfills
        (10, 'every Stripe subscription now has its own tier recorded', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' missing' END::text
               FROM "subscriptions"
              WHERE "stripe_subscription_id" IS NOT NULL
                AND "stripe_plan" IS NULL)),
        (11, 'every workspace Stripe is paying for says so in plan_source', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' rows' END::text
               FROM "subscriptions"
              WHERE "stripe_subscription_id" IS NOT NULL
                AND "plan" <> 'FREE'
                AND "status" IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
                AND "plan_source" <> 'STRIPE')),
        (12, 'no workspace was attributed to Google Play by this migration', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' rows' END::text
               FROM "subscriptions"
              WHERE "plan_source" = 'GOOGLE_PLAY')),
        (13, 'no plan_source is left NULL', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' rows' END::text
               FROM "subscriptions"
              WHERE "plan_source" IS NULL)),

        -- the purchase table
        (14, 'play_purchases exists', 'yes',
            (SELECT CASE WHEN to_regclass('"play_purchases"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (15, 'play_purchases has its twenty-five columns', '25',
            (SELECT count(*)::text FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'play_purchases')),
        (16, 'a purchase token names exactly one row', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_indexes
              WHERE schemaname = current_schema()
                AND indexname = 'play_purchases_purchase_token_key')),
        (17, 'the four lookup indexes are in place', '4',
            (SELECT count(*)::text FROM pg_indexes
              WHERE schemaname = current_schema()
                AND indexname IN (
                    'play_purchases_workspace_id_retired_at_idx',
                    'play_purchases_linked_purchase_token_idx',
                    'play_purchases_obfuscated_profile_id_idx',
                    'play_purchases_expiry_time_idx'))),
        (18, 'purchases cascade with their workspace', 'c',
            (SELECT confdeltype::text FROM pg_constraint
              WHERE conname = 'play_purchases_workspace_id_fkey'
                AND conrelid = to_regclass('"play_purchases"'))),
        (19, 'a purchase outlives the payer''s deleted profile', 'n',
            (SELECT confdeltype::text FROM pg_constraint
              WHERE conname = 'play_purchases_user_id_fkey'
                AND conrelid = to_regclass('"play_purchases"'))),
        (20, 'this migration invented no purchases', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' rows' END::text
               FROM "play_purchases")),

        -- earlier rounds still intact
        (21, 'round 8''s rename is still in place', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'profiles' AND column_name = 'celebration_seen_at')),
        (22, 'round 8''s two tables are still in place', 'yes',
            (SELECT CASE WHEN to_regclass('"pending_bank_connections"') IS NOT NULL
                          AND to_regclass('"account_deletion_requests"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (23, 'the net-worth tables from 0020 are still in place', 'yes',
            (SELECT CASE WHEN to_regclass('"assets"') IS NOT NULL
                          AND to_regclass('"asset_valuations"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (24, 'transaction dedupe index still in place', 'yes',
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
