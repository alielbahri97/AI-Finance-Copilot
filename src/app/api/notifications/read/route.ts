import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { markReadSchema } from "@/lib/validations/notification";
import { apiError } from "@/lib/api/response";

/** Marks the given notifications (or all unread) as read. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = markReadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const where = parsed.data.all
      ? { userId: user.id, readAt: null }
      : { userId: user.id, id: { in: parsed.data.ids }, readAt: null };

    const result = await prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });

    return NextResponse.json({ updated: result.count });
  } catch (error) {
    return apiError("POST /api/notifications/read", "Failed to update notifications", error);
  }
}
