-- apply-0022.sql — personal_profiles questionnaire table.
-- Prefer: npm run db:apply (records checksum in _prisma_migrations).
-- Or paste into Supabase SQL Editor after 0021 is applied.

BEGIN;

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

CREATE UNIQUE INDEX IF NOT EXISTS "personal_profiles_user_id_key"
  ON "personal_profiles"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'personal_profiles_user_id_fkey'
  ) THEN
    ALTER TABLE "personal_profiles"
      ADD CONSTRAINT "personal_profiles_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
