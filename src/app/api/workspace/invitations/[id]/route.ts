import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";

/** Revokes a pending invitation; the emailed link stops working immediately. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireWorkspace("manage_members");
  if (!auth.ok) return auth.response;
  const { user, workspace } = auth.ctx;
  const { id } = await context.params;

  const invitation = await prisma.workspaceInvitation.findFirst({
    where: { id, workspaceId: workspace.id, acceptedAt: null, revokedAt: null },
    select: { id: true, email: true },
  });
  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  await prisma.workspaceInvitation.update({
    where: { id: invitation.id },
    data: { revokedAt: new Date() },
  });
  await recordAudit(workspace.id, user.id, "member.invitation_revoked", {
    email: invitation.email,
  });

  return NextResponse.json({ ok: true });
}
