-- apply-0023.sql — product tour completion flag on profiles.
-- Prefer: npm run db:deploy (records checksum in _prisma_migrations).
-- Or paste into Supabase SQL Editor after 0022 is applied.

BEGIN;

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "tour_completed_at" TIMESTAMP(3);

UPDATE "profiles"
SET "tour_completed_at" = CURRENT_TIMESTAMP
WHERE "tour_completed_at" IS NULL;

COMMIT;
