import { NextResponse } from "next/server";

import { buildReport, getReportTransactions } from "@/lib/reports/data";
import { buildExcelReport } from "@/lib/reports/export-excel";
import { periodSlug, resolveReportRequest } from "@/lib/reports/query";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const { userId, currency, period } = resolved.context;
    const [report, transactions] = await Promise.all([
      buildReport(userId, currency, period),
      getReportTransactions(userId, period),
    ]);
    const bytes = await buildExcelReport(report, transactions);

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="finpilot-report-${periodSlug(period)}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/reports/export/excel failed:", error);
    return NextResponse.json({ error: "Failed to generate Excel report" }, { status: 500 });
  }
}
