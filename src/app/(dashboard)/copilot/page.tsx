import type { Metadata } from "next";
import { redirect } from "next/navigation";

import type { ChatMessageItem } from "@/components/copilot/chat";
import type { ConversationItem } from "@/components/copilot/conversation-sidebar";
import { CopilotShell } from "@/components/copilot/copilot-shell";
import { PageHeading } from "@/components/ui/page-heading";
import { buildFinancialSnapshot } from "@/lib/ai/context";
import { buildSuggestedQuestions } from "@/lib/ai/suggestions";
import { checkLimit, getEntitlements } from "@/lib/billing/entitlements";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Copilot" };
export const dynamic = "force-dynamic";

export default async function CopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("use_copilot")) redirect("/dashboard");
  const workspaceId = ctx.workspace.id;

  const params = await searchParams;
  const requestedId = Array.isArray(params.c) ? params.c[0] : params.c;

  const [conversations, snapshot, entitlements] = await Promise.all([
    prisma.conversation.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, title: true, updatedAt: true },
    }),
    buildFinancialSnapshot(workspaceId, ctx.workspace.currency),
    getEntitlements(workspaceId),
  ]);
  const aiQuota = checkLimit(
    entitlements,
    "aiMessages",
    entitlements.plan.limits.aiMessagesPerMonth
  );

  const activeId = requestedId && conversations.some((c) => c.id === requestedId)
    ? requestedId
    : null;

  const messages = activeId
    ? await prisma.chatMessage.findMany({
        where: { conversationId: activeId, conversation: { workspaceId } },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: { id: true, role: true, content: true, createdAt: true },
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
    createdAt: message.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <PageHeading>AI Copilot</PageHeading>
        <p className="text-muted-foreground text-sm">
          A financial assistant grounded in your transactions, trends and forecasts.
        </p>
      </div>
      <CopilotShell
        conversations={conversationItems}
        activeId={activeId}
        initialMessages={initialMessages}
        suggestions={buildSuggestedQuestions(snapshot, entitlements.edition)}
        quotaExhausted={!aiQuota.allowed}
      />
    </div>
  );
}
