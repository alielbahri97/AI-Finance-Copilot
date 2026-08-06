import "server-only";

import { NextResponse } from "next/server";

import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { canAddScenario } from "@/lib/finance/scenarios";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, type WorkspaceAuthResult } from "@/lib/workspace/context";
import type { Permission } from "@/lib/workspace/permissions";

/**
 * Scenarios sit behind the gate that already governs what goes in them:
 * `assumptionsEnabled`. A tier that cannot write a what-if has nothing to put
 * in a scenario, so there is no second thing to sell here — only a cap on how
 * many, which `requireScenarioQuota` enforces on top.
 *
 * Only the routes that *add* a scenario are gated, exactly as
 * `/api/assumptions` is: POST checks the plan, PATCH and DELETE check the
 * permission alone. A workspace that downgrades keeps the scenarios it already
 * named — it can read them, rename them and delete them, it just cannot make
 * more — which is the same promise the net-worth page makes about holdings.
 */
export async function requireScenarioAccess(
  ...required: Permission[]
): Promise<WorkspaceAuthResult> {
  const auth = await requireWorkspace(...required);
  if (!auth.ok) return auth;

  const entitlements = await getEntitlements(auth.ctx.workspace.id);
  if (!entitlements.plan.limits.assumptionsEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        upgradeError("Forecast scenarios", entitlements.planId, entitlements.edition),
        { status: 402 }
      ),
    };
  }

  return auth;
}

/**
 * The per-plan cap on named scenarios, checked immediately before a create.
 * The base scenario is not counted: it is not a row, and every tier has it.
 *
 * Returns null when there is room. The 402 body carries the same
 * `UPGRADE_REQUIRED` shape the rest of the app sends, plus the numbers, so the
 * dialog can say "3 of 3 used" instead of just refusing.
 */
export async function requireScenarioQuota(workspaceId: string): Promise<NextResponse | null> {
  const entitlements = await getEntitlements(workspaceId);
  const used = await prisma.scenario.count({ where: { workspaceId } });
  const quota = canAddScenario(used, entitlements.plan.limits.maxScenarios);
  if (quota.allowed) return null;

  return NextResponse.json(
    {
      ...upgradeError("Additional forecast scenarios", entitlements.planId, entitlements.edition),
      error:
        `The ${entitlements.plan.name} plan includes ${quota.limit} named ` +
        `${quota.limit === 1 ? "scenario" : "scenarios"}, and you are using ${quota.used}. ` +
        `Delete one, or upgrade on the Billing page for more.`,
      used: quota.used,
      limit: quota.limit,
    },
    { status: 402 }
  );
}
