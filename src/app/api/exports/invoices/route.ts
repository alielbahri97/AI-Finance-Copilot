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
import {
  buildInvoicesCsv,
  buildInvoicesExcel,
  loadExportInvoices,
  type InvoiceExportFilters,
} from "@/lib/exports/invoices";

export const maxDuration = 60;

function filtersFromUrl(url: URL): InvoiceExportFilters {
  return {
    status: url.searchParams.get("status") ?? undefined,
    vendor: url.searchParams.get("vendor") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    includeLines: url.searchParams.get("lines") === "1",
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "csv") as ExportFormat;
    if (format !== "csv" && format !== "excel") {
      return Response.json({ error: "format must be csv or excel" }, { status: 400 });
    }

    const gated = await assertExportAccess(format, {
      requiredPermissions: ["export_data", "view_invoices"],
      auditDetail: { dataset: "invoices", format },
    });
    if (!gated.ok) return gated.response;

    const { ctx } = gated.access;
    const filters = filtersFromUrl(url);
    const rows = await loadExportInvoices(ctx.workspace.id, filters);

    await incrementUsage(ctx.workspace.id, "exports");
    await trackEvent(ctx.user.id, "export", {
      format,
      dataset: "invoices",
      lines: filters.includeLines,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = filters.includeLines ? "invoices-lines" : "invoices";
    if (format === "csv") {
      return csvResponse(
        buildInvoicesCsv(rows, Boolean(filters.includeLines)),
        `${BRAND_SLUG}-${suffix}-${stamp}.csv`
      );
    }

    const bytes = await buildInvoicesExcel(
      rows,
      ctx.workspace.currency,
      Boolean(filters.includeLines)
    );
    return binaryResponse(
      bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `${BRAND_SLUG}-${suffix}-${stamp}.xlsx`
    );
  } catch (error) {
    return apiError("GET /api/exports/invoices", "Failed to export invoices", error);
  }
}
