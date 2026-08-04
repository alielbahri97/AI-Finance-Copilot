import "server-only";

import { NextResponse } from "next/server";

import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { requireEditionFeature, type WorkspaceAuthResult } from "@/lib/workspace/context";
import type { Permission } from "@/lib/workspace/permissions";

/**
 * Goals sit behind two independent gates, so both are checked in one place
 * rather than remembered route by route:
 *
 *   * the edition — goals do not exist in a Business workspace, which is a 404
 *     (`requireEditionFeature`), not a 403;
 *   * the plan — in a Personal workspace they exist but are not included on
 *     Free, which is a 402 with the standard upgrade payload.
 */
export async function requireGoalsAccess(
  ...required: Permission[]
): Promise<WorkspaceAuthResult> {
  const auth = await requireEditionFeature("goals", ...required);
  if (!auth.ok) return auth;

  const entitlements = await getEntitlements(auth.ctx.workspace.id);
  if (!entitlements.plan.limits.goalsEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        upgradeError("Savings goals", entitlements.planId, entitlements.edition),
        { status: 402 }
      ),
    };
  }

  return auth;
}
