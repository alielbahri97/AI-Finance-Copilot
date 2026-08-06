-- 0022_personal_profile
-- First-run questionnaire for Personal workspaces (goals, focus, income
-- snapshot). Additive only: one new table. Nothing is dropped or renamed.

CREATE TABLE "personal_profiles" (
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

CREATE UNIQUE INDEX "personal_profiles_user_id_key" ON "personal_profiles"("user_id");

ALTER TABLE "personal_profiles"
  ADD CONSTRAINT "personal_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
