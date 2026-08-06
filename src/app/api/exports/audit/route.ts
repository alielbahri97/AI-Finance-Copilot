import { trackEvent } from "@/lib/analytics";
import { incrementUsage } from "@/lib/billing/entitlements";
import { BRAND_SLUG } from "@/lib/branding";
import { apiError } from "@/lib/api/response";
import { buildAuditLogCsv } from "@/lib/exports/audit";
import { assertExportAccess, csvResponse } from "@/lib/exports/gate";

export const maxDuration = 60;

export async function GET() {
  try {
    const gated = await assertExportAccess("csv", {
      requiredPermissions: ["export_data", "manage_members"],
      auditDetail: { dataset: "audit-log", format: "csv" },
    });
    if (!gated.ok) return gated.response;

    const { ctx } = gated.access;
    const csv = await buildAuditLogCsv(ctx.workspace.id);

    await incrementUsage(ctx.workspace.id, "exports");
    await trackEvent(ctx.user.id, "export", { format: "csv", dataset: "audit-log" });

    const stamp = new Date().toISOString().slice(0, 10);
    return csvResponse(csv, `${BRAND_SLUG}-audit-log-${stamp}.csv`);
  } catch (error) {
    return apiError("GET /api/exports/audit", "Failed to export audit log", error);
  }
}
