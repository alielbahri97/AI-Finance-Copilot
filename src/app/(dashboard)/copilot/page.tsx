import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CopilotChat, type ChatMessageItem } from "@/components/copilot/chat";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Copilot" };
export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const history = await prisma.chatMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  const initialMessages: ChatMessageItem[] = history.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Copilot</h1>
        <p className="text-muted-foreground text-sm">
          Chat with an AI assistant grounded in your real financial data.
        </p>
      </div>
      <CopilotChat initialMessages={initialMessages} />
    </div>
  );
}
