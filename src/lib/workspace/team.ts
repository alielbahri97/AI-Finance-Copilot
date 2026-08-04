import "server-only";

import { logger, serializeError } from "@/lib/logger";
import { appUrl, isEmailConfigured, renderAlertEmail, sendEmail } from "@/lib/notifications/email";
import { prisma } from "@/lib/prisma";

/** Sends the invitation email; returns false when email isn't configured or fails. */
export async function sendInvitationEmail(options: {
  email: string;
  workspaceName: string;
  inviterName: string;
  inviteLink: string;
}): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const title = `${options.inviterName} invited you to ${options.workspaceName}`;
  const html = renderAlertEmail({
    title,
    bodyText: `${options.inviterName} invited you to join the "${options.workspaceName}" workspace on FinPilot.\n\nAccept the invitation with the button below. The link is personal, single-use and expires in 7 days.`,
    ctaLabel: "Accept invitation",
    ctaPath: options.inviteLink.replace(appUrl(), ""),
  });
  return sendEmail(options.email, title, html);
}

/** Creates an in-app WORKSPACE notification (best-effort, never throws). */
export async function notifyWorkspaceEvent(
  userId: string,
  title: string,
  body: string,
  link = "/settings"
): Promise<void> {
  try {
    await prisma.notification.create({
      data: { userId, type: "WORKSPACE", title, body, link },
    });
  } catch (error) {
    logger.error("[workspace] notification create failed", { error: serializeError(error) });
  }
}

/** Members + pending (unexpired, unrevoked) invitations — the seat usage. */
export async function countSeats(workspaceId: string, now = new Date()) {
  const [members, pending] = await Promise.all([
    prisma.workspaceMember.count({ where: { workspaceId } }),
    prisma.workspaceInvitation.count({
      where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    }),
  ]);
  return { members, pending };
}
