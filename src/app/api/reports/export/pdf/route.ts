import { NextResponse } from "next/server";

import { buildReport } from "@/lib/reports/data";
import { buildPdfReport } from "@/lib/reports/export-pdf";
import { periodSlug, resolveReportRequest } from "@/lib/reports/query";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const { userId, currency, period } = resolved.context;
    const report = await buildReport(userId, currency, period);
    const bytes = await buildPdfReport(report);

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="finpilot-report-${periodSlug(period)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/reports/export/pdf failed:", error);
    return NextResponse.json({ error: "Failed to generate PDF report" }, { status: 500 });
  }
}
