import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUsers, requireAdmin } from "@/lib/admin/stats";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function GET(request: Request) {
  try {
    const adminId = await requireAdmin();
    if (!adminId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ limit: url.searchParams.get("limit") ?? undefined });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }
    const users = await getAdminUsers(parsed.data.limit);
    return NextResponse.json({ users });
  } catch (error) {
    console.error("GET /api/admin/users failed:", error);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}
