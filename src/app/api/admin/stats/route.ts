import { NextResponse } from "next/server";

import { getAdminStats, requireAdmin } from "@/lib/admin/stats";

export async function GET() {
  try {
    const adminId = await requireAdmin();
    if (!adminId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const stats = await getAdminStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error("GET /api/admin/stats failed:", error);
    return NextResponse.json({ error: "Failed to load admin stats" }, { status: 500 });
  }
}
