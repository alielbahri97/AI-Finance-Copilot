import "server-only";

import { NextResponse } from "next/server";

import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { requireEditionFeature, type WorkspaceAuthResult } from "@/lib/workspace/context";
import type { Permission } from "@/lib/workspace/permissions";

/**
 * Net worth sits behind two independent gates, checked in one place rather
 * than remembered route by route — the same shape as `/api/goals/guard.ts`:
 *
 *   * the edition — a Business workspace has no net-worth page and no
 *     holdings, which is a 404 (`requireEditionFeature`), not a 403;
 *   * the plan — in a Personal workspace manual holdings are not included on
 *     Free, which is a 402 with the standard upgrade payload.
 *
 * Only the *manual* half is plan-gated. The page itself is not behind this
 * guard: it reports net worth from synced bank balances on every tier, so a
 * Free workspace sees a real figure and what upgrading would add.
 */
export async function requireNetWorthAccess(
  ...required: Permission[]
): Promise<WorkspaceAuthResult> {
  const auth = await requireEditionFeature("netWorth", ...required);
  if (!auth.ok) return auth;

  const entitlements = await getEntitlements(auth.ctx.workspace.id);
  if (!entitlements.plan.limits.netWorthEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        upgradeError("Assets and liabilities", entitlements.planId, entitlements.edition),
        { status: 402 }
      ),
    };
  }

  return auth;
}
