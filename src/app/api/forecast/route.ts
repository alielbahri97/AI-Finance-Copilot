import { NextResponse } from "next/server";

import { buildForecast } from "@/lib/finance/data";
import { apiError } from "@/lib/api/response";
import { requireWorkspace } from "@/lib/workspace/context";

export const maxDuration = 60;

/** Returns the full forecast, recomputed from current data on every request. */
export async function GET() {
  try {
    const auth = await requireWorkspace("view_reports");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const forecast = await buildForecast(workspace.id, workspace.currency);

    return NextResponse.json({ forecast });
  } catch (error) {
    return apiError("GET /api/forecast", "Failed to compute forecast", error);
  }
}
