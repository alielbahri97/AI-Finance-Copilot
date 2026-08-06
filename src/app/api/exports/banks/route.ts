import { trackEvent } from "@/lib/analytics";
import { incrementUsage } from "@/lib/billing/entitlements";
import { BRAND_SLUG } from "@/lib/branding";
import { apiError } from "@/lib/api/response";
import { buildBankBalancesCsv } from "@/lib/exports/banks";
import { assertExportAccess, csvResponse } from "@/lib/exports/gate";

export const maxDuration = 60;

export async function GET() {
  try {
    const gated = await assertExportAccess("csv", {
      requiredPermissions: ["export_data", "view_reports"],
      auditDetail: { dataset: "bank-balances", format: "csv" },
    });
    if (!gated.ok) return gated.response;

    const { ctx } = gated.access;
    const csv = await buildBankBalancesCsv(ctx.workspace.id, ctx.workspace.currency);

    await incrementUsage(ctx.workspace.id, "exports");
    await trackEvent(ctx.user.id, "export", { format: "csv", dataset: "bank-balances" });

    const stamp = new Date().toISOString().slice(0, 10);
    return csvResponse(csv, `${BRAND_SLUG}-bank-balances-${stamp}.csv`);
  } catch (error) {
    return apiError("GET /api/exports/banks", "Failed to export bank balances", error);
  }
}
