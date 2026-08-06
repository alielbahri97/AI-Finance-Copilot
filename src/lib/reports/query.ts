import "server-only";

import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { reportQuerySchema } from "@/lib/validations/report";
import { recordAudit } from "@/lib/workspace/audit";
import { getWorkspaceContext } from "@/lib/workspace/context";

import { resolvePeriod, type ResolvedPeriod } from "./period";

export interface ReportRequestContext {
  workspaceId: string;
  userId: string;
  currency: string;
  period: ResolvedPeriod;
  dataset: "transactions" | "monthly";
}

export type ReportExportFormat = "csv" | "excel" | "pdf";

/**
 * Shared auth + query validation for the export routes. Returns either the
 * resolved context or an error response payload. Requires view_reports +
 * export_data in the current workspace and records an audit entry.
 *
 * Plan rule: CSV is free on every plan; Excel and PDF need `exportsEnabled`.
 */
export async function resolveReportRequest(
  request: Request,
  format: ReportExportFormat = "csv"
): Promise<{ context: ReportRequestContext } | { error: string; status: number }> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return { error: "Unauthorized", status: 401 };
  if (!ctx.permissions.has("view_reports") || !ctx.permissions.has("export_data")) {
    return {
      error: "You don't have permission to export data from this workspace.",
      status: 403,
    };
  }

  const limited = await checkRateLimit(`export:${ctx.user.id}`, RATE_LIMITS.export);
  if (!limited.allowed) {
    return { error: "Too many export requests — please wait a moment.", status: 429 };
  }

  const entitlements = await getEntitlements(ctx.workspace.id);
  if ((format === "excel" || format === "pdf") && !entitlements.plan.limits.exportsEnabled) {
    return {
      error: upgradeError("Excel and PDF exports", entitlements.planId, entitlements.edition)
        .error,
      status: 402,
    };
  }

  const url = new URL(request.url);
  const parsed = reportQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid query", status: 400 };
  }

  await recordAudit(ctx.workspace.id, ctx.user.id, "data.export", {
    dataset: parsed.data.dataset ?? "transactions",
    period: parsed.data.period,
    format,
  });

  return {
    context: {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      currency: ctx.workspace.currency,
      period: resolvePeriod(parsed.data.period, parsed.data.from, parsed.data.to),
      dataset: parsed.data.dataset ?? "transactions",
    },
  };
}

/** File-name-safe slug for the current period, e.g. `2026-07-01_2026-07-27`. */
export function periodSlug(period: ResolvedPeriod): string {
  return `${period.from.toISOString().slice(0, 10)}_${period.to.toISOString().slice(0, 10)}`;
}
