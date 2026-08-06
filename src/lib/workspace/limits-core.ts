import type { WorkspaceType } from "./editions";

/** How many workspaces one account may own in total. */
export const MAX_OWNED_WORKSPACES = 5;

export interface WorkspaceCreationPolicy {
  canCreatePersonal: boolean;
  canCreateBusiness: boolean;
  ownsPersonal: boolean;
  ownsBusiness: boolean;
  crossEditionUnlocked: boolean;
  personalBlockedReason: string | null;
  businessBlockedReason: string | null;
}

/** Pure rules — unit-tested without a database. */
export function decideWorkspaceCreationPolicy(input: {
  ownsPersonal: boolean;
  ownsBusiness: boolean;
  crossEditionUnlocked: boolean;
  ownedCount: number;
}): WorkspaceCreationPolicy {
  const { ownsPersonal, ownsBusiness, crossEditionUnlocked, ownedCount } = input;

  let personalBlockedReason: string | null = null;
  let businessBlockedReason: string | null = null;

  if (ownsPersonal) {
    personalBlockedReason =
      "You already have a Personal workspace. Only one is allowed per account.";
  } else if (ownsBusiness && !crossEditionUnlocked) {
    personalBlockedReason =
      "A company account cannot also open an individual workspace unless you are on Enterprise or Premium. Those plans unlock both editions.";
  }

  if (ownsPersonal && !crossEditionUnlocked) {
    businessBlockedReason =
      "An individual account cannot also open a company workspace unless you are on Premium or Enterprise. Those plans unlock both editions.";
  }

  if (ownedCount >= MAX_OWNED_WORKSPACES) {
    const cap = `You can own up to ${MAX_OWNED_WORKSPACES} workspaces. Leave or delete one first.`;
    if (!personalBlockedReason) personalBlockedReason = cap;
    if (!businessBlockedReason) businessBlockedReason = cap;
  }

  return {
    canCreatePersonal: personalBlockedReason === null,
    canCreateBusiness: businessBlockedReason === null,
    ownsPersonal,
    ownsBusiness,
    crossEditionUnlocked,
    personalBlockedReason,
    businessBlockedReason,
  };
}

export function creationBlockReason(
  policy: WorkspaceCreationPolicy,
  type: WorkspaceType
): string | null {
  return type === "PERSONAL" ? policy.personalBlockedReason : policy.businessBlockedReason;
}
