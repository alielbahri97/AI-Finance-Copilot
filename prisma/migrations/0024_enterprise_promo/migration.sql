-- 0024_enterprise_promo
-- One-shot flag for the complimentary Enterprise celebration dialog.
-- Additive only: existing accounts keep NULL until they see the promo (or
-- never, if they are not on the allowlist).

ALTER TABLE "profiles" ADD COLUMN "enterprise_promo_seen_at" TIMESTAMP(3);
