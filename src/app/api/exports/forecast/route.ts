import { trackEvent } from "@/lib/analytics";
import { incrementUsage } from "@/lib/billing/entitlements";
import { BRAND_SLUG } from "@/lib/branding";
import { apiError } from "@/lib/api/response";
import {
  assertExportAccess,
  binaryResponse,
  csvResponse,
  type ExportFormat,
} from "@/lib/exports/gate";
import { buildForecastCsv, buildForecastExcel, buildForecastPdf } from "@/lib/exports/forecast";
import { buildForecast } from "@/lib/finance/data";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "csv") as ExportFormat;
    if (format !== "csv" && format !== "excel" && format !== "pdf") {
      return Response.json({ error: "format must be csv, excel or pdf" }, { status: 400 });
    }

    const gated = await assertExportAccess(format, {
      requiredPermissions: ["export_data", "view_reports"],
      auditDetail: { dataset: "forecast", format },
    });
    if (!gated.ok) return gated.response;

    const { ctx } = gated.access;
    const assumptions = await prisma.assumption.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "asc" },
    });
    const forecast = await buildForecast(ctx.workspace.id, ctx.workspace.currency, assumptions);

    await incrementUsage(ctx.workspace.id, "exports");
    await trackEvent(ctx.user.id, "export", { format, dataset: "forecast" });

    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "csv") {
      return csvResponse(buildForecastCsv(forecast), `${BRAND_SLUG}-forecast-${stamp}.csv`);
    }
    if (format === "excel") {
      const bytes = await buildForecastExcel(forecast);
      return binaryResponse(
        bytes,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        `${BRAND_SLUG}-forecast-${stamp}.xlsx`
      );
    }
    const pdf = await buildForecastPdf(forecast);
    return binaryResponse(pdf, "application/pdf", `${BRAND_SLUG}-forecast-${stamp}.pdf`);
  } catch (error) {
    return apiError("GET /api/exports/forecast", "Failed to export forecast", error);
  }
}
