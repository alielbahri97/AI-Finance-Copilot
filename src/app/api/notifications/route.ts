import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { apiError } from "@/lib/api/response";

/** Latest notifications plus the unread count for the bell badge. */
export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);

    return NextResponse.json({
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch (error) {
    return apiError("GET /api/notifications", "Failed to load notifications", error);
  }
}
