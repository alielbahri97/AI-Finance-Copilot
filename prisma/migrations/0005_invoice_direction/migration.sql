-- CreateEnum
CREATE TYPE "InvoiceDirection" AS ENUM ('PAYABLE', 'RECEIVABLE');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "direction" "InvoiceDirection" NOT NULL DEFAULT 'PAYABLE';

-- CreateIndex
CREATE INDEX "invoices_user_id_direction_status_idx" ON "invoices"("user_id", "direction", "status");
