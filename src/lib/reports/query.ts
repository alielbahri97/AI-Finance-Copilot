import "server-only";

import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { getOrCreateProfile } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { reportQuerySchema } from "@/lib/validations/report";

import { resolvePeriod, type ResolvedPeriod } from "./period";

export interface ReportRequestContext {
  userId: string;
  currency: string;
  period: ResolvedPeriod;
  dataset: "transactions" | "monthly";
}

/**
 * Shared auth + query validation for the export routes. Returns either the
 * resolved context or an error response payload.
 */
export async function resolveReportRequest(
  request: Request
): Promise<{ context: ReportRequestContext } | { error: string; status: number }> {
  const user = await getUser();
  if (!user) return { error: "Unauthorized", status: 401 };

  // Plan gating: exports are a paid feature.
  const entitlements = await getEntitlements(user.id);
  if (!entitlements.plan.limits.exportsEnabled) {
    return { error: upgradeError("Report exports", entitlements.planId).error, status: 402 };
  }

  const url = new URL(request.url);
  const parsed = reportQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid query", status: 400 };
  }

  const profile = await getOrCreateProfile(user);
  return {
    context: {
      userId: user.id,
      currency: profile.currency,
      period: resolvePeriod(parsed.data.period, parsed.data.from, parsed.data.to),
      dataset: parsed.data.dataset ?? "transactions",
    },
  };
}

/** File-name-safe slug for the current period, e.g. `2026-07-01_2026-07-27`. */
export function periodSlug(period: ResolvedPeriod): string {
  return `${period.from.toISOString().slice(0, 10)}_${period.to.toISOString().slice(0, 10)}`;
}
