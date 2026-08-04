import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";
import { isPendingInvitation, planInvitationRegeneration } from "@/lib/workspace/invitations";
import { sendInvitationEmail } from "@/lib/workspace/team";

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/**
 * Issues a fresh link for a pending invitation. Only the token hash is stored,
 * so the original link cannot be recovered — the old invitation is revoked and
 * replaced by an identical one with a new token and expiry. Seat usage is
 * unchanged because exactly one of the two rows is pending at any moment.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkspace("manage_members");
  if (!auth.ok) return auth.response;
  const { user, workspace } = auth.ctx;
  const { id } = await context.params;

  const existing = await prisma.workspaceInvitation.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, email: true, role: true, acceptedAt: true, revokedAt: true, expiresAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }
  if (!isPendingInvitation(existing)) {
    return NextResponse.json(
      { error: "That invitation is no longer pending. Invite the person again instead." },
      { status: 409 }
    );
  }

  const plan = planInvitationRegeneration();
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.workspaceInvitation.update({
      where: { id: existing.id },
      data: { revokedAt: plan.revokedAt },
    });
    return tx.workspaceInvitation.create({
      data: {
        workspaceId: workspace.id,
        email: existing.email,
        role: existing.role,
        tokenHash: plan.tokenHash,
        expiresAt: plan.expiresAt,
        invitedById: user.id,
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
  });
  await recordAudit(workspace.id, user.id, "member.invitation_regenerated", {
    email: existing.email,
    replacedInvitationId: existing.id,
  });

  const inviteLink = appUrl(`/invite/${plan.token}`);
  const inviterName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "A teammate";
  const delivery = await sendInvitationEmail({
    email: existing.email,
    workspaceName: workspace.name,
    inviterName,
    inviteLink,
  });

  return NextResponse.json({ invitation, inviteLink, emailDelivery: delivery });
}
