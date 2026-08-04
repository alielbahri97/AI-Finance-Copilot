import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api/response";
import { requireWorkspace } from "@/lib/workspace/context";

type RouteContext = { params: Promise<{ id: string }> };

const renameSchema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(80),
});

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireWorkspace("use_copilot");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const body = await request.json();
    const parsed = renameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid title", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const result = await prisma.conversation.updateMany({
      where: { id, workspaceId: workspace.id },
      data: { title: parsed.data.title },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("PATCH /api/conversations/[id]", "Failed to rename conversation", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireWorkspace("use_copilot");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    // Messages are removed by the cascading foreign key.
    const result = await prisma.conversation.deleteMany({
      where: { id, workspaceId: workspace.id },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("DELETE /api/conversations/[id]", "Failed to delete conversation", error);
  }
}
