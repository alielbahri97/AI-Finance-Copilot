/**
 * Personal workspaces use the deterministic id "ws-<userId>" (and their
 * OWNER membership "wsm-<userId>"): created by the 0014 migration for
 * existing users and by getOrCreateProfile for new signups. Referral rewards
 * and workspace fallbacks rely on this invariant.
 */
export function personalWorkspaceId(userId: string): string {
  return `ws-${userId}`;
}

export function personalMembershipId(userId: string): string {
  return `wsm-${userId}`;
}
