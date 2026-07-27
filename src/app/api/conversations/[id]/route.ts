import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { apiError } from "@/lib/api/response";

type RouteContext = { params: Promise<{ id: string }> };

const renameSchema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(80),
});

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      where: { id, userId: user.id },
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
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    // Messages are removed by the cascading foreign key.
    const result = await prisma.conversation.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("DELETE /api/conversations/[id]", "Failed to delete conversation", error);
  }
}
