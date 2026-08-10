-- 0026_mobile_api
-- Two tables the native client needs, both additive.
--
-- pending_bank_connections replaces the httpOnly cookie that used to carry a
-- GoCardless requisition between the connect redirect and the callback. The
-- cookie held one attempt, so a second connection started in another tab
-- overwrote the first; and a native app has no cookie jar between the bank's
-- browser and itself, so the flow could not work there at all.
--
-- account_deletion_requests records a user's request to erase their account and
-- outlives the account: it deliberately has no foreign key to profiles, because
-- every table that does have one is gone by the time the deletion finishes.

CREATE TYPE "PendingConnectionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TYPE "AccountDeletionStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED', 'FAILED');

CREATE TABLE "pending_bank_connections" (
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

CREATE UNIQUE INDEX "pending_bank_connections_reference_key"
    ON "pending_bank_connections"("reference");

CREATE INDEX "pending_bank_connections_workspace_id_user_id_status_idx"
    ON "pending_bank_connections"("workspace_id", "user_id", "status");

CREATE INDEX "pending_bank_connections_expires_at_idx"
    ON "pending_bank_connections"("expires_at");

ALTER TABLE "pending_bank_connections"
    ADD CONSTRAINT "pending_bank_connections_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pending_bank_connections"
    ADD CONSTRAINT "pending_bank_connections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "account_deletion_requests" (
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

CREATE INDEX "account_deletion_requests_user_id_idx"
    ON "account_deletion_requests"("user_id");

CREATE INDEX "account_deletion_requests_status_scheduled_for_idx"
    ON "account_deletion_requests"("status", "scheduled_for");
