import "server-only";

import { getEntitlements } from "@/lib/billing/entitlements";
import { prisma } from "@/lib/prisma";

import {
  creationBlockReason,
  decideWorkspaceCreationPolicy,
  MAX_OWNED_WORKSPACES,
  type WorkspaceCreationPolicy,
} from "./limits-core";

export {
  creationBlockReason,
  decideWorkspaceCreationPolicy,
  MAX_OWNED_WORKSPACES,
  type WorkspaceCreationPolicy,
};

/**
 * Rules for creating another owned workspace:
 * - At most one Personal workspace per account.
 * - Business and Personal stay separate unless an owned workspace is on
 *   Enterprise (Business) or Premium (Personal), which unlock cross-edition.
 * - Invited membership in the other edition is always fine (not gated here).
 */
export async function getWorkspaceCreationPolicy(
  userId: string
): Promise<WorkspaceCreationPolicy> {
  const owned = await prisma.workspaceMember.findMany({
    where: { userId, role: "OWNER" },
    select: { workspace: { select: { id: true, type: true } } },
  });

  const ownsPersonal = owned.some((row) => row.workspace.type === "PERSONAL");
  const ownsBusiness = owned.some((row) => row.workspace.type === "BUSINESS");

  let crossEditionUnlocked = false;
  for (const row of owned) {
    const entitlements = await getEntitlements(row.workspace.id);
    if (entitlements.plan.limits.crossEditionEnabled) {
      crossEditionUnlocked = true;
      break;
    }
  }

  return decideWorkspaceCreationPolicy({
    ownsPersonal,
    ownsBusiness,
    crossEditionUnlocked,
    ownedCount: owned.length,
  });
}
