import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { serializeDashboard } from "@/lib/api/serializers/dashboard";
import { getDashboardData } from "@/lib/data";
import { requireWorkspace } from "@/lib/workspace/context";
import { editionForWorkspaceType } from "@/lib/workspace/editions";

export const dynamic = "force-dynamic";

/**
 * The home screen's figures.
 *
 * Opening the dashboard needs no permission — the web page does not gate itself
 * either. What it gates are the individual sections, so the same three flags
 * ride along in `sections` and a client renders the cards it is allowed to
 * instead of asking and being refused three times.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.ok) return auth.response;
    const { workspace, permissions } = auth.ctx;

    const data = await getDashboardData(workspace.id);

    return NextResponse.json({
      dashboard: serializeDashboard(data),
      currency: workspace.currency,
      edition: editionForWorkspaceType(workspace.type),
      sections: {
        transactions: permissions.has("view_transactions"),
        invoices: permissions.has("view_invoices"),
        reports: permissions.has("view_reports"),
      },
    });
  } catch (error) {
    return apiError("GET /api/dashboard", "Failed to load dashboard", error);
  }
}
