-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_user_id_updated_at_idx" ON "conversations"("user_id", "updated_at" DESC);

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Attach existing chat messages to a per-user "Earlier conversation" so the
-- new NOT NULL conversation_id column can be added without data loss.
ALTER TABLE "chat_messages" ADD COLUMN "conversation_id" TEXT;

INSERT INTO "conversations" ("id", "user_id", "title", "created_at", "updated_at")
SELECT
    'legacy-' || "user_id"::text,
    "user_id",
    'Earlier conversation',
    MIN("created_at"),
    MAX("created_at")
FROM "chat_messages"
GROUP BY "user_id";

UPDATE "chat_messages"
SET "conversation_id" = 'legacy-' || "user_id"::text
WHERE "conversation_id" IS NULL;

ALTER TABLE "chat_messages" ALTER COLUMN "conversation_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
