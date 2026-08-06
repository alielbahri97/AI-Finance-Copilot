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
  buildFilteredTransactionsCsv,
  buildFilteredTransactionsExcel,
  loadExportTransactions,
  type TransactionExportFilters,
} from "@/lib/exports/transactions";

export const maxDuration = 60;

function filtersFromUrl(url: URL): TransactionExportFilters {
  return {
    q: url.searchParams.get("q") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    batch: url.searchParams.get("batch") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    min: url.searchParams.get("min") ?? undefined,
    max: url.searchParams.get("max") ?? undefined,
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
      requiredPermissions: ["export_data", "view_transactions"],
      auditDetail: { dataset: "transactions", format },
    });
    if (!gated.ok) return gated.response;

    const { ctx } = gated.access;
    const filters = filtersFromUrl(url);
    const rows = await loadExportTransactions(ctx.workspace.id, filters);

    await incrementUsage(ctx.workspace.id, "exports");
    await trackEvent(ctx.user.id, "export", { format, dataset: "transactions" });

    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "csv") {
      return csvResponse(
        buildFilteredTransactionsCsv(rows),
        `${BRAND_SLUG}-transactions-${stamp}.csv`
      );
    }

    const bytes = await buildFilteredTransactionsExcel(rows, ctx.workspace.currency);
    return binaryResponse(
      bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `${BRAND_SLUG}-transactions-${stamp}.xlsx`
    );
  } catch (error) {
    return apiError("GET /api/exports/transactions", "Failed to export transactions", error);
  }
}
