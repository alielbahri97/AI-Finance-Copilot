-- 0019_customer_dunning
-- Customer-facing payment reminders for unpaid receivables.
--
-- Plan:
--   1. Somewhere to send them: invoices carry an optional customer address.
--      Nullable on purpose — an invoice without one is simply never dunned,
--      which is also what keeps every invoice that exists today out of the
--      automatic pass until somebody fills it in.
--   2. A per-workspace opt-in for the automatic pass. Default false: mail
--      goes out under the workspace's own name, so nothing is sent on
--      anybody's behalf until they ask for it.
--   3. The reminder log. It is the audit trail and, through the unique key
--      on (invoice_id, kind), the reason an escalation step can never be
--      sent twice for the same invoice — including when two crons overlap.
--
-- Additive only: one nullable column, one column with a constant default
-- (metadata-only on PostgreSQL 11+), one enum and one new table. Code that
-- predates this migration never reads any of it.

-- CreateEnum
CREATE TYPE "DunningStep" AS ENUM ('DUE_SOON', 'OVERDUE_1', 'OVERDUE_2', 'FINAL');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "customer_email" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "auto_dunning_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "reminder_logs" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "kind" "DunningStep" NOT NULL,
    "to_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sent_by" UUID,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminder_logs_invoice_id_kind_key" ON "reminder_logs"("invoice_id", "kind");

-- CreateIndex
CREATE INDEX "reminder_logs_invoice_id_sent_at_idx" ON "reminder_logs"("invoice_id", "sent_at" DESC);

-- AddForeignKey
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
