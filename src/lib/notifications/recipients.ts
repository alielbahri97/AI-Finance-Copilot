import "server-only";

import { prisma } from "@/lib/prisma";
import { hasPermission, type Permission } from "@/lib/workspace/permissions";

export interface NotifiableMember {
  userId: string;
  email: string;
}

/**
 * Workspace members who are allowed to receive notifications about a piece
 * of business data — i.e. members holding the given permission. Whether each
 * member actually gets in-app/email/push is decided by their own
 * NotificationPreference at dispatch time.
 */
export async function listNotifiableMembers(
  workspaceId: string,
  permission: Permission
): Promise<NotifiableMember[]> {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: {
      userId: true,
      role: true,
      permissions: true,
      profile: { select: { email: true } },
    },
  });
  return members
    .filter((member) => hasPermission(member.role, member.permissions, permission))
    .map((member) => ({ userId: member.userId, email: member.profile.email }));
}
