-- Help-agent chat: one lightweight thread per user, separate from the
-- finance copilot's conversations. Reuses the existing "ChatRole" enum.

-- CreateTable
CREATE TABLE "help_messages" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "help_messages_user_id_created_at_idx" ON "help_messages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "help_messages" ADD CONSTRAINT "help_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
