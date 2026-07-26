import type { Metadata } from "next";
import { redirect } from "next/navigation";

import type { ChatMessageItem } from "@/components/copilot/chat";
import type { ConversationItem } from "@/components/copilot/conversation-sidebar";
import { CopilotShell } from "@/components/copilot/copilot-shell";
import { buildFinancialSnapshot } from "@/lib/ai/context";
import { buildSuggestedQuestions } from "@/lib/ai/suggestions";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Copilot" };
export const dynamic = "force-dynamic";

export default async function CopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const requestedId = Array.isArray(params.c) ? params.c[0] : params.c;

  const profile = await getOrCreateProfile(user);

  const [conversations, snapshot] = await Promise.all([
    prisma.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, title: true, updatedAt: true },
    }),
    buildFinancialSnapshot(user.id, profile.currency),
  ]);

  const activeId = requestedId && conversations.some((c) => c.id === requestedId)
    ? requestedId
    : null;

  const messages = activeId
    ? await prisma.chatMessage.findMany({
        where: { conversationId: activeId, userId: user.id },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: { id: true, role: true, content: true },
      })
    : [];

  const conversationItems: ConversationItem[] = conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt.toISOString(),
  }));

  const initialMessages: ChatMessageItem[] = messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Copilot</h1>
        <p className="text-muted-foreground text-sm">
          A financial assistant grounded in your transactions, trends and forecasts.
        </p>
      </div>
      <CopilotShell
        conversations={conversationItems}
        activeId={activeId}
        initialMessages={initialMessages}
        suggestions={buildSuggestedQuestions(snapshot)}
      />
    </div>
  );
}
