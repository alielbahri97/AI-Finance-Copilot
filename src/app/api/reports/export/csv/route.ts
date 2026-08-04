import { NextResponse } from "next/server";

import { trackEvent } from "@/lib/analytics";
import { incrementUsage } from "@/lib/billing/entitlements";
import { BRAND_SLUG } from "@/lib/branding";
import { buildReport, getReportTransactions } from "@/lib/reports/data";
import { buildMonthlySummaryCsv, buildTransactionsCsv } from "@/lib/reports/export-csv";
import { periodSlug, resolveReportRequest } from "@/lib/reports/query";
import { apiError } from "@/lib/api/response";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const { workspaceId, userId, currency, period, dataset } = resolved.context;
    const csv =
      dataset === "monthly"
        ? buildMonthlySummaryCsv(await buildReport(workspaceId, currency, period))
        : buildTransactionsCsv(await getReportTransactions(workspaceId, period));

    await incrementUsage(workspaceId, "exports");
    await trackEvent(userId, "export", { format: "csv", dataset });

    const suffix = dataset === "monthly" ? "monthly-summary" : "transactions";
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${BRAND_SLUG}-${suffix}-${periodSlug(period)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError("GET /api/reports/export/csv", "Failed to generate CSV export", error);
  }
}
