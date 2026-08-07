-- 0023_product_tour
-- First-login guided tour flag on profiles. Additive only: one nullable
-- column. Existing accounts are marked done so they are not interrupted;
-- new signups keep NULL and see the tour after onboarding.

ALTER TABLE "profiles" ADD COLUMN "tour_completed_at" TIMESTAMP(3);

UPDATE "profiles"
SET "tour_completed_at" = CURRENT_TIMESTAMP
WHERE "tour_completed_at" IS NULL;
