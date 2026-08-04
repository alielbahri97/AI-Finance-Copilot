import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api/response";
import { requireWorkspace } from "@/lib/workspace/context";

export async function GET() {
  try {
    const auth = await requireWorkspace("use_copilot");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const conversations = await prisma.conversation.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true },
    });

    return NextResponse.json({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return apiError("GET /api/conversations", "Failed to load conversations", error);
  }
}
