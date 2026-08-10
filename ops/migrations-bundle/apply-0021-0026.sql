-- =====================================================================
-- apply-0021-0026.sql
--
-- Applies the six pending Prisma migrations to the ai-finance-copilot
-- production database and records each in "_prisma_migrations" so that a
-- later `npm run db:apply` sees them as already applied.
--
--   0021_forecast_scenarios  sha256 2dcc4989b5ae4fb39acb1b776ced3bd11b31033bfea05a621719dee7546e359c
--   0022_personal_profile    sha256 e721ef88ca59fa6d50aabbd73033478df1dafc05fc7ea091c0206e9606778f3f
--   0023_product_tour        sha256 97b358732783d6d8a91c07ad51a3a19ecc7fabaf31636a80f7783cf273676ff8
--   0024_enterprise_promo    sha256 4235fcc9ed6099afb9c2aed7532147665c442242869d2b677366b4544086c6ac
--   0025_celebration_seen    sha256 9662fb1d5d725ca96f26fb2ff7f70731635b0734c6c3ffb6d7f4391ac7628f38
--   0026_mobile_api          sha256 4970b9fcedd09cf9baa658e38dee149d02f23e91669c6c85799bd79c607f1662
--
-- The checksums are sha256 (hex) of the exact bytes of each
-- prisma/migrations/<name>/migration.sql with LF line endings, which is
-- precisely how scripts/apply-migrations.ts computes them on Linux and
-- macOS. See the line-ending note in README.md.
--
-- HOW TO RUN: paste this entire file into the Supabase SQL Editor
-- (New query) and press Run. See README.md next to this file.
--
-- PREREQUISITE: 0020_net_worth must already be applied
-- (apply-0020.sql). STEP 0a stops with a clear error if it is not,
-- before anything is changed.
--
-- THIS FILE SUPERSEDES apply-0021.sql, apply-0022.sql and
-- apply-0023.sql. Do not run those as well; running this one alone
-- covers everything they do and more. (It is harmless if you already
-- ran one of them — every step here converges.)
--
-- WHAT IT DOES
--   0021  Creates "scenarios" (the named what-if sets a workspace
--         forecasts against) and "assumptions"."scenario_id" pointing at
--         it. NULL *is* the base scenario, so nothing is backfilled.
--   0022  Creates "personal_profiles", the first-run questionnaire for
--         Personal workspaces. One row per profile.
--   0023  Adds "profiles"."tour_completed_at" and marks every account
--         that exists today as having done the tour, so nobody is
--         interrupted by a tour of an app they already know.
--   0024  Adds "profiles"."enterprise_promo_seen_at".
--   0025  RENAMES that column to "celebration_seen_at".
--   0026  Creates "pending_bank_connections" (the GoCardless handshake
--         row that replaces an httpOnly cookie) and
--         "account_deletion_requests" (the seven-day cancellable
--         erase-my-account queue), plus the two enums they use.
--
-- ORDER IS MANDATORY, AND 0024 -> 0025 IS THE REASON
--   0025 renames the very column 0024 creates. Applied in order, the
--   database ends up with exactly one column, "celebration_seen_at",
--   and no "enterprise_promo_seen_at" at all. That is the correct end
--   state and it is what the deployed code reads. Applying 0025 without
--   0024 fails ("column does not exist"); applying 0024 after 0025
--   would leave a stray unused column behind. STEP 4/STEP 5 below are
--   written so that this file reaches the right end state from any of
--   the three possible starting points, but do not reorder them by hand
--   and do not paste only part of this file.
--
-- SAFETY PROPERTIES
--   * Everything runs inside ONE transaction, so a failure rolls the
--     whole thing back and the database is untouched.
--   * Additive apart from the 0024 -> 0025 rename, which renames a
--     column this migration series created moments earlier and which no
--     deployed code has ever read under its old name. No existing table
--     is dropped or narrowed, and no pre-existing column is renamed.
--   * Safe to run more than once. Every table, column, index, enum and
--     foreign key is guarded, and the one statement that changes rows
--     (0023's tour backfill) is additionally skipped once 0023 is
--     recorded as applied — see STEP 3 for why that matters.
--   * The SQL bodies are faithful to the migration files except for the
--     added existence guards. No semantics change on a first, clean
--     application.
--   * Code deployed before these migrations keeps working: it simply
--     never reads the new tables or columns.
--   * NOT SAFE TO ROLL BACK PAST 0026 ONCE 0026 IS APPLIED *and* the
--     mobile-API deployment is live, because the web bank-connect flow
--     then writes "pending_bank_connections". Rolling the deployment
--     back to code that still uses the cookie works (it just ignores
--     the table); rolling the *database* back does not. Roll forward.
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
-- STEP 0a.  Refuse to run on a database that predates 0020.
--
-- Checking the schema rather than the bookkeeping row is deliberate: a
-- `db:push` database has the columns without the history rows, and that
-- is a perfectly fine place to apply this bundle.
--
-- "assumptions" and "profiles" are the two existing tables these
-- migrations alter, so their absence is worth naming separately rather
-- than failing halfway through on an ALTER TABLE.
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
    IF to_regclass('"assumptions"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "assumptions", which 0003_assumptions creates. This does not look like an ai-finance-copilot database.';
    END IF;
    IF to_regclass('"assets"') IS NULL THEN
        RAISE EXCEPTION
            'This database is missing "assets", which 0020_net_worth adds. Run ops/migrations-bundle/apply-0020.sql first, then run this file.';
    END IF;
END
$prereq$;


-- ---------------------------------------------------------------------
-- STEP 0b.  Baseline 0001..0020 if the table was just created.
--
-- Production should already have all twenty rows. This block exists for
-- the case where "_prisma_migrations" is missing or empty, where
-- recording only 0021..0026 would leave 0001..0020 looking pending and
-- the next `npm run db:apply` would try to re-run 0001_init and fail
-- with "type TransactionType already exists".
--
-- STEP 0a has already established that the 0020 schema is present, so
-- baselining it here is a statement of fact, not a guess.
--
-- The checksums are carried over unchanged from apply-0021.sql.
-- ---------------------------------------------------------------------

DO $baseline$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations") THEN
        RAISE NOTICE 'No migration history found: baselining 0001..0020 as already applied.';

        INSERT INTO "_prisma_migrations"
            ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
        VALUES
            (gen_random_uuid()::text, '332fe85d68cc2b7f59e185a80d59f0ab77a3190731c9bd04198c8c12ec9670d8', now(), '0001_init',                    'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e039b143a3efcd37cd5510da397e5c9c9257c88e47a2b9413f827a07a57e58de', now(), '0002_conversations',           'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f13fdae0cab023db0aa497a18c3806e93dc8b0cd0791f8a3d3efdb137c0c572c', now(), '0003_assumptions',             'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '173b3ba227e28f44e7edfb84717f486e51a5479f9f75593db47515794a6c371a', now(), '0004_invoices',                'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'a561ec34107a955ddcf90641fbf6c1e4046cb93bf5389c402704757e34a87aef', now(), '0005_invoice_direction',       'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3a1ec7964d65c7cd22dbcd8c10978d44e7401a234cbccf728944a0d7c579130e', now(), '0006_notifications',           'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '16646d546727f9682c96010e1b4b2363e190cfa152cd807ca70c42f44d1614c7', now(), '0007_saas',                    'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'e0ef73f1d3051871ff83d759b1c98784eeec39175623c2e4edd6c5beec91b824', now(), '0008_integrations',            'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '35a31eb5a75dec76d5e2973b75df8d3d1f5d0aa5b91fff1e0318cbef4cc5c633', now(), '0009_performance_indexes',     'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3d335be70a6bb0bc7903e2fe6810b75c3dec1e2e6a18c365e170b28907683d7c', now(), '0010_ai_provider_groq',        'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6c568731d02e58f11fadd7303584610fe1ad72a2c51b64e17ddbc3f91a098337', now(), '0011_business_profile',        'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'd0497dffcd8646003887e8eb6ccc0a480460eecb97beca6e70b8d258b346a84f', now(), '0012_default_ai_provider_groq', 'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7b474d1fd822f2774a75a3c5fd75ee1bbfec4f0e8d36d80f8677611aa3dbb2d', now(), '0013_help_messages',           'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '0648890dda5ff8d916dd674424531264a1da1d9f976a0b75a31aa85f64d1743e', now(), '0014_workspaces',              'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'c7aad200de37b496f33bbe77e2dcffbbd47fa25b4a1f17a2e94ab8aec7e6ff9f', now(), '0015_extraction_telemetry',    'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'f92b0da30a50ac653bd603aa512c1a5fdb3fdd9227cb02218b503ae4d72b5fb8', now(), '0016_multi_bank_connections',  'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '6ea302ea168c82af6f8f6e627f879809a4ea48cecc2b5c47d83f1ee9422d681d', now(), '0017_workspace_editions',      'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '3a670714d7c810ec2a5756b1f1ba214422e79bc2b3f310eb0a80165141079500', now(), '0018_ai_categorization',       'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, '0cd9e7a2a9099cc862fa4323ccbe5305921cc52b7f683bc4c912ba98460a2364', now(), '0019_customer_dunning',        'baselined by apply-0021-0026.sql', NULL, now(), 1),
            (gen_random_uuid()::text, 'ef31084c0ebfb00083cff17b112c6f02216cb5d5a51f72e1cf8ec47d1cc453c7', now(), '0020_net_worth',               'baselined by apply-0021-0026.sql', NULL, now(), 1);
    END IF;
END
$baseline$;


-- ---------------------------------------------------------------------
-- STEP 0c.  Clear out any failed / rolled-back attempt for 0021..0026.
-- scripts/apply-migrations.ts refuses to run (throws) when it finds such
-- a row, so removing it here keeps `npm run db:apply` usable afterwards.
-- ---------------------------------------------------------------------

DELETE FROM "_prisma_migrations"
 WHERE "migration_name" IN (
        '0021_forecast_scenarios',
        '0022_personal_profile',
        '0023_product_tour',
        '0024_enterprise_promo',
        '0025_celebration_seen',
        '0026_mobile_api')
   AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL);


-- ---------------------------------------------------------------------
-- STEP 0d.  Tell the operator what is about to happen.
-- ---------------------------------------------------------------------

DO $preflight$
DECLARE
    already TEXT;
BEGIN
    SELECT string_agg("migration_name", ', ' ORDER BY "migration_name")
      INTO already
      FROM "_prisma_migrations"
     WHERE "migration_name" IN (
            '0021_forecast_scenarios',
            '0022_personal_profile',
            '0023_product_tour',
            '0024_enterprise_promo',
            '0025_celebration_seen',
            '0026_mobile_api')
       AND "finished_at" IS NOT NULL
       AND "rolled_back_at" IS NULL;

    IF already IS NULL THEN
        RAISE NOTICE 'Applying 0021, 0022, 0023, 0024, 0025 and 0026.';
    ELSE
        RAISE NOTICE 'Already recorded as applied, and will only be re-checked: %', already;
    END IF;
END
$preflight$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0021_forecast_scenarios
-- sha256 2dcc4989b5ae4fb39acb1b776ced3bd11b31033bfea05a621719dee7546e359c
--
-- The named what-if sets a workspace forecasts against, and the column
-- that says which one an assumption belongs to.
-- =====================================================================
-- =====================================================================

-- ------------------------------------------------------ 1. the scenarios

-- No numbers on this row on purpose: a scenario is a name for a set of
-- assumptions, and the forecast engine is what turns those into numbers.
CREATE TABLE IF NOT EXISTS "scenarios" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------- 2. which scenario an
--                                               assumption belongs to
--
-- NULLABLE, with no default and no backfill, because NULL is not "not
-- set yet" — it *is* the base scenario. Every assumption in the database
-- right now keeps applying to the forecast exactly as before, as part of
-- the base scenario, and a workspace that never names one sees no
-- change at all. On PostgreSQL this ADD COLUMN only touches the
-- catalog: no rewrite, no backfill, no lock worth naming.
ALTER TABLE "assumptions" ADD COLUMN IF NOT EXISTS "scenario_id" TEXT;

-- ---------------------------------------------------------- 3. the indexes

-- One scenario per name per workspace: two "Base case" rows would make
-- the switcher a guessing game.
CREATE UNIQUE INDEX IF NOT EXISTS "scenarios_workspace_id_name_key"
    ON "scenarios"("workspace_id", "name");

CREATE INDEX IF NOT EXISTS "scenarios_workspace_id_created_at_idx"
    ON "scenarios"("workspace_id", "created_at");

-- Deleting a scenario cascades to its assumptions, and that DELETE looks
-- rows up by "scenario_id" alone.
CREATE INDEX IF NOT EXISTS "assumptions_scenario_id_idx"
    ON "assumptions"("scenario_id");

-- ----------------------------------------------------- 4. the foreign keys

DO $fks_0021$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'scenarios_workspace_id_fkey'
           AND conrelid = to_regclass('"scenarios"')
    ) THEN
        ALTER TABLE "scenarios"
          ADD CONSTRAINT "scenarios_workspace_id_fkey"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- Deleting a scenario takes the assumptions written into it with it:
    -- they describe that one hypothesis and mean nothing detached from
    -- it. Base-scenario assumptions hold NULL here and are never touched
    -- by that cascade.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'assumptions_scenario_id_fkey'
           AND conrelid = to_regclass('"assumptions"')
    ) THEN
        ALTER TABLE "assumptions"
          ADD CONSTRAINT "assumptions_scenario_id_fkey"
          FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$fks_0021$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0022_personal_profile
-- sha256 e721ef88ca59fa6d50aabbd73033478df1dafc05fc7ea091c0206e9606778f3f
--
-- The first-run questionnaire for Personal workspaces: life stage, what
-- the person is focused on, and a rough income/essentials snapshot.
-- =====================================================================
-- =====================================================================

-- Scoped to the profile rather than the workspace: the answers describe
-- a person, and they follow them across every personal workspace they
-- own. "completed_at" and "skipped_at" are both nullable and both
-- meaningful — skipping is an answer, and the app must not ask again.
CREATE TABLE IF NOT EXISTS "personal_profiles" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "life_stage" TEXT NOT NULL,
    "primary_focus" TEXT NOT NULL,
    "monthly_income" DECIMAL(14,2),
    "monthly_essentials" DECIMAL(14,2),
    "has_debt" BOOLEAN NOT NULL DEFAULT false,
    "emergency_months" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "completed_at" TIMESTAMP(3),
    "skipped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_profiles_pkey" PRIMARY KEY ("id")
);

-- One questionnaire per person, which is also what the app upserts
-- against.
CREATE UNIQUE INDEX IF NOT EXISTS "personal_profiles_user_id_key"
    ON "personal_profiles"("user_id");

DO $fks_0022$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'personal_profiles_user_id_fkey'
           AND conrelid = to_regclass('"personal_profiles"')
    ) THEN
        ALTER TABLE "personal_profiles"
          ADD CONSTRAINT "personal_profiles_user_id_fkey"
          FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$fks_0022$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0023_product_tour
-- sha256 97b358732783d6d8a91c07ad51a3a19ecc7fabaf31636a80f7783cf273676ff8
--
-- The first-login guided tour flag, plus the one row-changing statement
-- in this whole bundle.
-- =====================================================================
-- =====================================================================

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "tour_completed_at" TIMESTAMP(3);

-- The migration marks every account that exists at migration time as
-- having done the tour, so established users are not walked through an
-- app they already know. New signups keep NULL and see it after
-- onboarding.
--
-- THIS IS THE ONE STATEMENT THAT MUST NOT BE RE-RUN BLIND. The original
-- migration's `WHERE tour_completed_at IS NULL` is correct exactly once.
-- Run it again a week later and it would sweep up everyone who signed up
-- in the meantime and silently rob them of the tour — the same class of
-- mistake the 0016 and 0017 bundles guard against. So it is skipped
-- entirely once 0023 is recorded as applied, and on a `db:push` database
-- with no history it is skipped when the column already holds values.
DO $tour$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "_prisma_migrations"
         WHERE "migration_name" = '0023_product_tour'
           AND "finished_at" IS NOT NULL
           AND "rolled_back_at" IS NULL
    ) THEN
        RAISE NOTICE '0023 already applied: leaving "tour_completed_at" exactly as it is.';
    ELSIF EXISTS (SELECT 1 FROM "profiles" WHERE "tour_completed_at" IS NOT NULL) THEN
        RAISE NOTICE 'Some profiles already have "tour_completed_at" set: leaving every row alone rather than guessing.';
    ELSE
        UPDATE "profiles"
           SET "tour_completed_at" = CURRENT_TIMESTAMP
         WHERE "tour_completed_at" IS NULL;
    END IF;
END
$tour$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0024_enterprise_promo
-- sha256 4235fcc9ed6099afb9c2aed7532147665c442242869d2b677366b4544086c6ac
--
-- The one-shot flag for the complimentary Enterprise celebration
-- dialog, under its original name.
--
-- READ THIS TOGETHER WITH 0025 BELOW. 0025 renames this column. The
-- guard here is what lets the pair be re-run: the column is added only
-- when neither name is present, so a database that has already been
-- through both migrations is not given back the old name it just lost.
-- =====================================================================
-- =====================================================================

DO $promo$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'profiles'
           AND column_name = 'celebration_seen_at'
    ) THEN
        RAISE NOTICE '"profiles"."celebration_seen_at" already exists: 0024 and 0025 are both done.';
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'profiles'
           AND column_name = 'enterprise_promo_seen_at'
    ) THEN
        RAISE NOTICE '"profiles"."enterprise_promo_seen_at" already exists: 0024 is done, 0025 follows.';
    ELSE
        ALTER TABLE "profiles" ADD COLUMN "enterprise_promo_seen_at" TIMESTAMP(3);
    END IF;
END
$promo$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0025_celebration_seen
-- sha256 9662fb1d5d725ca96f26fb2ff7f70731635b0734c6c3ffb6d7f4391ac7628f38
--
-- Renames the one-shot celebration flag so it applies to every member
-- (welcome + complimentary Enterprise copy), not only allowlisted
-- emails.
--
-- ORDERING: this must run after 0024, and after this runs there is no
-- "enterprise_promo_seen_at" column left at all. "celebration_seen_at"
-- is the only name the deployed code knows, and /api/health checks for
-- it by that name. The rename carries any values across, so nothing is
-- lost even though at this point in history there is nothing to carry.
-- =====================================================================
-- =====================================================================

DO $celebration$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'profiles'
           AND column_name = 'celebration_seen_at'
    ) THEN
        RAISE NOTICE '"profiles"."celebration_seen_at" is already in place: nothing to rename.';
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'profiles'
           AND column_name = 'enterprise_promo_seen_at'
    ) THEN
        ALTER TABLE "profiles"
          RENAME COLUMN "enterprise_promo_seen_at" TO "celebration_seen_at";
    ELSE
        -- Cannot happen: STEP 0024 above guarantees one of the two names
        -- exists by now. Fail loudly rather than commit a database the
        -- deployed profile code cannot read.
        RAISE EXCEPTION
            'Neither "enterprise_promo_seen_at" nor "celebration_seen_at" exists on "profiles" after 0024 ran. Stopping rather than committing a half-migrated schema.';
    END IF;
END
$celebration$;



-- =====================================================================
-- =====================================================================
-- MIGRATION 0026_mobile_api
-- sha256 4970b9fcedd09cf9baa658e38dee149d02f23e91669c6c85799bd79c607f1662
--
-- The two tables the native client needs, both additive.
--
-- "pending_bank_connections" replaces the httpOnly cookie that used to
-- carry a GoCardless requisition between the connect redirect and the
-- callback. The cookie held one attempt, so a second connection started
-- in another tab overwrote the first — a real web bug, not only a mobile
-- one — and a native app has no cookie jar shared between the bank's
-- browser and itself, so the flow could not work there at all.
--
-- "account_deletion_requests" records a request to erase an account and
-- deliberately outlives the account: it has no foreign key to
-- "profiles", because every table that does have one is gone by the time
-- the deletion finishes. "email_hash" is what lets support answer "did
-- this address ask to be deleted?" without keeping the address.
-- =====================================================================
-- =====================================================================

-- ------------------------------------------------------------ 1. the enums
--
-- CREATE TYPE has no IF NOT EXISTS form, so guard on to_regtype.

DO $enums_0026$
BEGIN
    IF to_regtype('"PendingConnectionStatus"') IS NULL THEN
        CREATE TYPE "PendingConnectionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
    END IF;
    IF to_regtype('"AccountDeletionStatus"') IS NULL THEN
        CREATE TYPE "AccountDeletionStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED', 'FAILED');
    END IF;
END
$enums_0026$;

-- ------------------------------------------- 2. the bank handshake row

CREATE TABLE IF NOT EXISTS "pending_bank_connections" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gocardless',
    "requisition_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "status" "PendingConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "connection_id" TEXT,
    "error" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_bank_connections_pkey" PRIMARY KEY ("id")
);

-- The reference is what comes back from the bank, so it has to identify
-- exactly one attempt.
CREATE UNIQUE INDEX IF NOT EXISTS "pending_bank_connections_reference_key"
    ON "pending_bank_connections"("reference");

-- "what is this user still waiting on in this workspace?"
CREATE INDEX IF NOT EXISTS "pending_bank_connections_workspace_id_user_id_status_idx"
    ON "pending_bank_connections"("workspace_id", "user_id", "status");

-- Sweeping abandoned attempts.
CREATE INDEX IF NOT EXISTS "pending_bank_connections_expires_at_idx"
    ON "pending_bank_connections"("expires_at");

DO $fks_0026$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'pending_bank_connections_workspace_id_fkey'
           AND conrelid = to_regclass('"pending_bank_connections"')
    ) THEN
        ALTER TABLE "pending_bank_connections"
          ADD CONSTRAINT "pending_bank_connections_workspace_id_fkey"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'pending_bank_connections_user_id_fkey'
           AND conrelid = to_regclass('"pending_bank_connections"')
    ) THEN
        ALTER TABLE "pending_bank_connections"
          ADD CONSTRAINT "pending_bank_connections_user_id_fkey"
          FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$fks_0026$;

-- --------------------------------------- 3. the account deletion queue
--
-- No foreign key on "user_id" on purpose — see the header. The sweep
-- looks rows up by ("status", "scheduled_for").

CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "email_hash" TEXT NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "account_deletion_requests_user_id_idx"
    ON "account_deletion_requests"("user_id");

CREATE INDEX IF NOT EXISTS "account_deletion_requests_status_scheduled_for_idx"
    ON "account_deletion_requests"("status", "scheduled_for");



-- =====================================================================
-- STEP 9.  Record the six migrations in "_prisma_migrations".
--
-- Columns and values match exactly what scripts/apply-migrations.ts
-- writes on success:
--   (id, checksum, finished_at, migration_name, logs, started_at,
--    applied_steps_count) = (uuid, sha256-hex, now(), name, NULL, now(), 1)
-- rolled_back_at is left NULL.
--
-- Each INSERT is a no-op if a row for that migration already exists, so
-- an existing record is never duplicated.
-- =====================================================================

INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text, v.checksum, now(), v.name, NULL, NULL, now(), 1
  FROM (VALUES
        ('2dcc4989b5ae4fb39acb1b776ced3bd11b31033bfea05a621719dee7546e359c', '0021_forecast_scenarios'),
        ('e721ef88ca59fa6d50aabbd73033478df1dafc05fc7ea091c0206e9606778f3f', '0022_personal_profile'),
        ('97b358732783d6d8a91c07ad51a3a19ecc7fabaf31636a80f7783cf273676ff8', '0023_product_tour'),
        ('4235fcc9ed6099afb9c2aed7532147665c442242869d2b677366b4544086c6ac', '0024_enterprise_promo'),
        ('9662fb1d5d725ca96f26fb2ff7f70731635b0734c6c3ffb6d7f4391ac7628f38', '0025_celebration_seen'),
        ('4970b9fcedd09cf9baa658e38dee149d02f23e91669c6c85799bd79c607f1662', '0026_mobile_api')
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

-- Check 1: migration history. Expect 26 rows, 0021..0026 each present
-- with a finished_at timestamp and no rolled_back_at.
SELECT "migration_name",
       "checksum",
       "finished_at",
       "rolled_back_at",
       "applied_steps_count"
  FROM "_prisma_migrations"
 ORDER BY "migration_name";

-- Check 2: the shape of the new tables and of the altered ones.
SELECT "table_name", "column_name", "data_type", "is_nullable", "column_default"
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND "table_name" IN ('scenarios', 'assumptions', 'personal_profiles',
                        'profiles', 'pending_bank_connections',
                        'account_deletion_requests')
 ORDER BY "table_name", "ordinal_position";

-- Check 3: how many accounts were marked as having done the tour, and
-- how many are still due one. Right after a first application every
-- existing profile should be in the first column and the second should
-- be 0; new signups move into it afterwards, which is the feature
-- working rather than drift.
SELECT count(*) FILTER (WHERE "tour_completed_at" IS NOT NULL) AS "tour_marked_done",
       count(*) FILTER (WHERE "tour_completed_at" IS NULL)     AS "tour_still_due",
       count(*)                                                AS "profiles_total"
  FROM "profiles";

-- Check 4: the summary. Every row should read 'OK'.
WITH checks (sort_order, check_name, expected, actual) AS (
    VALUES
        (1, 'all six migrations recorded'::text, '6 of 6'::text,
            (SELECT count(DISTINCT "migration_name") || ' of 6'
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
                AND "migration_name" IN (
                    '0021_forecast_scenarios', '0022_personal_profile',
                    '0023_product_tour', '0024_enterprise_promo',
                    '0025_celebration_seen', '0026_mobile_api'))),
        (2, 'recorded checksums match the repo files', '6 of 6',
            (SELECT count(*) || ' of 6'
               FROM "_prisma_migrations"
              WHERE ("migration_name", "checksum") IN (
                    ('0021_forecast_scenarios', '2dcc4989b5ae4fb39acb1b776ced3bd11b31033bfea05a621719dee7546e359c'),
                    ('0022_personal_profile',   'e721ef88ca59fa6d50aabbd73033478df1dafc05fc7ea091c0206e9606778f3f'),
                    ('0023_product_tour',       '97b358732783d6d8a91c07ad51a3a19ecc7fabaf31636a80f7783cf273676ff8'),
                    ('0024_enterprise_promo',   '4235fcc9ed6099afb9c2aed7532147665c442242869d2b677366b4544086c6ac'),
                    ('0025_celebration_seen',   '9662fb1d5d725ca96f26fb2ff7f70731635b0734c6c3ffb6d7f4391ac7628f38'),
                    ('0026_mobile_api',         '4970b9fcedd09cf9baa658e38dee149d02f23e91669c6c85799bd79c607f1662')))),
        (3, 'no failed/rolled-back migration rows', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE 'NO' END::text
               FROM "_prisma_migrations"
              WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL)),
        (4, 'full migration history present', '26 of 26',
            (SELECT count(DISTINCT "migration_name") || ' of 26'
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
                    '0024_enterprise_promo', '0025_celebration_seen', '0026_mobile_api'))),

        -- 0021
        (5, 'scenarios exists', 'yes',
            (SELECT CASE WHEN to_regclass('"scenarios"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (6, 'a scenario name cannot be used twice in one workspace', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_indexes
              WHERE schemaname = current_schema()
                AND indexname = 'scenarios_workspace_id_name_key')),
        (7, 'assumptions.scenario_id exists and is NULLABLE text', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'assumptions' AND column_name = 'scenario_id'
                AND is_nullable = 'YES' AND data_type = 'text'
                AND column_default IS NULL)),
        (8, 'assumptions cascade with their scenario', 'c',
            (SELECT confdeltype::text FROM pg_constraint
              WHERE conname = 'assumptions_scenario_id_fkey'
                AND conrelid = to_regclass('"assumptions"'))),
        (9, 'every existing assumption is still in the base scenario', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' were moved' END::text
               FROM "assumptions" WHERE "scenario_id" IS NOT NULL)),
        (10, 'this migration invented no scenarios', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' rows' END::text
               FROM "scenarios")),

        -- 0022
        (11, 'personal_profiles exists', 'yes',
            (SELECT CASE WHEN to_regclass('"personal_profiles"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (12, 'personal_profiles has its thirteen columns', '13',
            (SELECT count(*)::text FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'personal_profiles')),
        (13, 'one questionnaire per person', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_indexes
              WHERE schemaname = current_schema()
                AND indexname = 'personal_profiles_user_id_key')),
        (14, 'personal_profiles cascade with their profile', 'c',
            (SELECT confdeltype::text FROM pg_constraint
              WHERE conname = 'personal_profiles_user_id_fkey'
                AND conrelid = to_regclass('"personal_profiles"'))),

        -- 0023
        (15, 'profiles.tour_completed_at exists and is nullable', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'profiles' AND column_name = 'tour_completed_at'
                AND is_nullable = 'YES')),

        -- 0024 + 0025: the rename. Both rows matter.
        (16, 'profiles.celebration_seen_at exists (0025 rename done)', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'profiles' AND column_name = 'celebration_seen_at'
                AND is_nullable = 'YES')),
        (17, 'the pre-rename column is gone (no stray 0024 leftover)', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE 'NO — both names present' END::text
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'profiles'
                AND column_name = 'enterprise_promo_seen_at')),

        -- 0026
        (18, 'pending_bank_connections exists', 'yes',
            (SELECT CASE WHEN to_regclass('"pending_bank_connections"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (19, 'a bank reference identifies exactly one attempt', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_indexes
              WHERE schemaname = current_schema()
                AND indexname = 'pending_bank_connections_reference_key')),
        (20, 'pending connections cascade with their workspace', 'c',
            (SELECT confdeltype::text FROM pg_constraint
              WHERE conname = 'pending_bank_connections_workspace_id_fkey'
                AND conrelid = to_regclass('"pending_bank_connections"'))),
        (21, 'PendingConnectionStatus has its three labels', '3',
            (SELECT count(*)::text FROM pg_enum
              WHERE enumtypid = to_regtype('"PendingConnectionStatus"'))),
        (22, 'account_deletion_requests exists', 'yes',
            (SELECT CASE WHEN to_regclass('"account_deletion_requests"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (23, 'AccountDeletionStatus has its four labels', '4',
            (SELECT count(*)::text FROM pg_enum
              WHERE enumtypid = to_regtype('"AccountDeletionStatus"'))),
        (24, 'the deletion sweep index is in place', 'yes',
            (SELECT CASE WHEN count(*) = 1 THEN 'yes' ELSE 'NO' END::text
               FROM pg_indexes
              WHERE schemaname = current_schema()
                AND indexname = 'account_deletion_requests_status_scheduled_for_idx')),
        (25, 'deletion requests deliberately outlive the profile (no FK)', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE 'NO' END::text
               FROM pg_constraint
              WHERE conrelid = to_regclass('"account_deletion_requests"')
                AND contype = 'f')),
        (26, 'no deletion was invented by this migration', 'yes',
            (SELECT CASE WHEN count(*) = 0 THEN 'yes' ELSE count(*) || ' rows' END::text
               FROM "account_deletion_requests")),

        -- earlier rounds still intact
        (27, 'the net-worth tables from 0020 are still in place', 'yes',
            (SELECT CASE WHEN to_regclass('"assets"') IS NOT NULL
                          AND to_regclass('"asset_valuations"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (28, 'the dunning table from 0019 is still in place', 'yes',
            (SELECT CASE WHEN to_regclass('"reminder_logs"') IS NOT NULL
                         THEN 'yes' ELSE 'NO' END::text)),
        (29, 'transaction dedupe index still in place', 'yes',
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
