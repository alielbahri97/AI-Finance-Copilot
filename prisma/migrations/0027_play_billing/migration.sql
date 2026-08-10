-- 0027_play_billing
-- Google Play Billing: a workspace can now be paid for on the web through
-- Stripe or on a phone through Google Play. Everything here is additive.
--
-- play_purchases is the source of truth for the Play side, one row per purchase
-- token. Rows are retired rather than deleted when Play issues a replacement
-- token on an upgrade, downgrade or resubscribe, because a refund can still
-- arrive against the old token afterwards.
--
-- subscriptions gains three columns. plan_source records which payer won
-- resolution, so the billing screen can offer the right management affordance
-- (Stripe's portal, a Play deep link, or neither for a complimentary grant).
-- stripe_plan and stripe_status hold Stripe's own tier and status beside the
-- resolved cache, so a complimentary grant writing ENTERPRISE over the top no
-- longer erases the fact that a paid Stripe subscription exists underneath.
-- Both are backfilled from the resolved columns for workspaces that already
-- have a Stripe subscription, which is the best available answer and is exact
-- for every row that is not currently overridden.

CREATE TYPE "PlanSource" AS ENUM ('FREE', 'TRIAL', 'COMPLIMENTARY', 'STRIPE', 'GOOGLE_PLAY');

ALTER TABLE "subscriptions"
    ADD COLUMN "plan_source" "PlanSource" NOT NULL DEFAULT 'FREE',
    ADD COLUMN "stripe_plan" "PlanId",
    ADD COLUMN "stripe_status" "SubscriptionStatus";

UPDATE "subscriptions"
   SET "stripe_plan" = "plan",
       "stripe_status" = "status"
 WHERE "stripe_subscription_id" IS NOT NULL;

UPDATE "subscriptions"
   SET "plan_source" = 'STRIPE'
 WHERE "stripe_subscription_id" IS NOT NULL
   AND "plan" <> 'FREE'
   AND "status" IN ('ACTIVE', 'TRIALING', 'PAST_DUE');

UPDATE "subscriptions"
   SET "plan_source" = 'TRIAL'
 WHERE "plan_source" = 'FREE'
   AND "trial_ends_at" IS NOT NULL
   AND "trial_ends_at" > NOW();

CREATE TABLE "play_purchases" (
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

CREATE UNIQUE INDEX "play_purchases_purchase_token_key"
    ON "play_purchases"("purchase_token");

CREATE INDEX "play_purchases_workspace_id_retired_at_idx"
    ON "play_purchases"("workspace_id", "retired_at");

CREATE INDEX "play_purchases_linked_purchase_token_idx"
    ON "play_purchases"("linked_purchase_token");

CREATE INDEX "play_purchases_obfuscated_profile_id_idx"
    ON "play_purchases"("obfuscated_profile_id");

CREATE INDEX "play_purchases_expiry_time_idx"
    ON "play_purchases"("expiry_time");

ALTER TABLE "play_purchases"
    ADD CONSTRAINT "play_purchases_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: when the payer deletes their account and the workspace
-- survives because other members are still in it, the purchase that pays for
-- that workspace has to survive too.
ALTER TABLE "play_purchases"
    ADD CONSTRAINT "play_purchases_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
