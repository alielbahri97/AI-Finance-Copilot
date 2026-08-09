-- 0025_celebration_seen
-- Rename the one-shot celebration flag so it applies to every member
-- (welcome + complimentary Enterprise copy), not only allowlisted emails.

ALTER TABLE "profiles" RENAME COLUMN "enterprise_promo_seen_at" TO "celebration_seen_at";
