import { NextResponse } from "next/server";

import { buildReport, getReportTransactions } from "@/lib/reports/data";
import { buildMonthlySummaryCsv, buildTransactionsCsv } from "@/lib/reports/export-csv";
import { periodSlug, resolveReportRequest } from "@/lib/reports/query";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const { userId, currency, period, dataset } = resolved.context;
    const csv =
      dataset === "monthly"
        ? buildMonthlySummaryCsv(await buildReport(userId, currency, period))
        : buildTransactionsCsv(await getReportTransactions(userId, period));

    const suffix = dataset === "monthly" ? "monthly-summary" : "transactions";
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="finpilot-${suffix}-${periodSlug(period)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/reports/export/csv failed:", error);
    return NextResponse.json({ error: "Failed to generate CSV export" }, { status: 500 });
  }
}
