import "server-only";

import { canAddBankConnection, type BankConnectionCheck } from "@/lib/billing/plans";
import { prisma } from "@/lib/prisma";

import { getProviders } from "./registry";

/**
 * How many banks a workspace may link at once.
 *
 * The Personal edition sells this directly — Free includes one bank, Plus
 * removes the limit — so it is enforced where a bank flow *starts*, not where
 * it finishes: sending someone through their bank's consent screen and then
 * refusing the result would be the worst possible place to mention a plan.
 *
 * Only banking providers count. A Slack channel or a calendar is not a bank
 * account, and the accounting providers are gated by edition instead.
 */
export function bankProviderIds(): string[] {
  return getProviders()
    .filter((provider) => provider.category === "banking")
    .map((provider) => provider.id);
}

export async function checkBankConnectionQuota(
  workspaceId: string,
  limit: number | null
): Promise<BankConnectionCheck> {
  if (limit === null) return canAddBankConnection(0, null);

  const used = await prisma.integrationConnection.count({
    where: { workspaceId, provider: { in: bankProviderIds() } },
  });
  return canAddBankConnection(used, limit);
}

/** The message shown when the plan's bank allowance is already spent. */
export function bankQuotaRefusal(check: BankConnectionCheck, planName: string): string {
  const allowance =
    check.limit === 0
      ? "does not include bank connections"
      : `includes ${check.limit} bank connection${check.limit === 1 ? "" : "s"}`;
  return `Your ${planName} plan ${allowance}. Disconnect one first, or upgrade for unlimited banks.`;
}
