import { NextResponse } from "next/server";

import { getAdminStats, requireAdmin } from "@/lib/admin/stats";
import { apiError } from "@/lib/api/response";

export async function GET() {
  try {
    const adminId = await requireAdmin();
    if (!adminId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const stats = await getAdminStats();
    return NextResponse.json(stats);
  } catch (error) {
    return apiError("GET /api/admin/stats", "Failed to load admin stats", error);
  }
}
