import { trackEvent } from "@/lib/analytics";
import { incrementUsage } from "@/lib/billing/entitlements";
import { BRAND_SLUG } from "@/lib/branding";
import { apiError } from "@/lib/api/response";
import { assertExportAccess, binaryResponse } from "@/lib/exports/gate";
import { buildFullDataZip } from "@/lib/exports/full-export";

export const maxDuration = 60;

/** Full workspace data export — always free (portability). */
export async function GET() {
  try {
    const gated = await assertExportAccess("zip", {
      requiredPermissions: ["export_data"],
      auditDetail: { dataset: "full", format: "zip" },
    });
    if (!gated.ok) return gated.response;

    const { ctx } = gated.access;
    const bytes = await buildFullDataZip(
      ctx.workspace.id,
      ctx.workspace.currency,
      ctx.workspace.name
    );

    await incrementUsage(ctx.workspace.id, "exports");
    await trackEvent(ctx.user.id, "export", { format: "zip", dataset: "full" });

    const stamp = new Date().toISOString().slice(0, 10);
    return binaryResponse(bytes, "application/zip", `${BRAND_SLUG}-full-export-${stamp}.zip`);
  } catch (error) {
    return apiError("GET /api/exports/full", "Failed to build full data export", error);
  }
}
