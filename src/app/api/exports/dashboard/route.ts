import { trackEvent } from "@/lib/analytics";
import { incrementUsage } from "@/lib/billing/entitlements";
import { BRAND_SLUG } from "@/lib/branding";
import { apiError } from "@/lib/api/response";
import { getDashboardData } from "@/lib/data";
import { assertExportAccess, binaryResponse } from "@/lib/exports/gate";
import { buildDashboardPdf } from "@/lib/exports/dashboard";

export const maxDuration = 60;

export async function GET() {
  try {
    const gated = await assertExportAccess("pdf", {
      requiredPermissions: ["export_data", "view_reports"],
      auditDetail: { dataset: "dashboard", format: "pdf" },
    });
    if (!gated.ok) return gated.response;

    const { ctx } = gated.access;
    const data = await getDashboardData(ctx.workspace.id);
    const bytes = await buildDashboardPdf(data, ctx.workspace.currency, ctx.workspace.name);

    await incrementUsage(ctx.workspace.id, "exports");
    await trackEvent(ctx.user.id, "export", { format: "pdf", dataset: "dashboard" });

    const stamp = new Date().toISOString().slice(0, 10);
    return binaryResponse(bytes, "application/pdf", `${BRAND_SLUG}-dashboard-${stamp}.pdf`);
  } catch (error) {
    return apiError("GET /api/exports/dashboard", "Failed to export dashboard PDF", error);
  }
}
