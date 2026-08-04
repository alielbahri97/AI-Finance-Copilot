import { NextResponse } from "next/server";

import { trackEvent } from "@/lib/analytics";
import { incrementUsage } from "@/lib/billing/entitlements";
import { buildReport, getReportTransactions } from "@/lib/reports/data";
import { buildExcelReport } from "@/lib/reports/export-excel";
import { periodSlug, resolveReportRequest } from "@/lib/reports/query";
import { apiError } from "@/lib/api/response";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const { workspaceId, userId, currency, period } = resolved.context;
    const [report, transactions] = await Promise.all([
      buildReport(workspaceId, currency, period),
      getReportTransactions(workspaceId, period),
    ]);
    const bytes = await buildExcelReport(report, transactions);
    await incrementUsage(workspaceId, "exports");
    await trackEvent(userId, "export", { format: "excel" });

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="finpilot-report-${periodSlug(period)}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError("GET /api/reports/export/excel", "Failed to generate Excel report", error);
  }
}
