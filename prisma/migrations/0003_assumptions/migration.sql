-- CreateEnum
CREATE TYPE "AssumptionKind" AS ENUM ('ONE_OFF', 'RECURRING', 'PERCENT_GROWTH');

-- CreateTable
CREATE TABLE "assumptions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "AssumptionKind" NOT NULL,
    "type" "TransactionType" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "percent" DECIMAL(6,2),
    "date" TIMESTAMP(3),
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assumptions_user_id_idx" ON "assumptions"("user_id");

-- AddForeignKey
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
