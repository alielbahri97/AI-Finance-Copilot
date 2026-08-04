import { NextResponse } from "next/server";
import { z } from "zod";

import { getEntitlements } from "@/lib/billing/entitlements";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/workspace/audit";
import { WORKSPACE_COOKIE } from "@/lib/workspace/context";
import { assessInvitation, canAddSeat, hashInviteToken } from "@/lib/workspace/invitations";
import { notifyWorkspaceEvent } from "@/lib/workspace/team";

const acceptSchema = z.object({ token: z.string().min(20).max(200) });

const REASON_MESSAGES: Record<string, string> = {
  accepted: "This invitation has already been used.",
  revoked: "This invitation was revoked.",
  expired: "This invitation has expired. Ask for a new one.",
  email_mismatch:
    "This invitation was sent to a different email address. Sign in with the invited account.",
};

/** Accepts an invitation by raw token. Requires a logged-in user whose email matches. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Sign in to accept the invitation." }, { status: 401 });
  }

  const parsed = acceptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid invitation link" }, { status: 400 });
  }

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { tokenHash: hashInviteToken(parsed.data.token) },
    select: {
      id: true,
      workspaceId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      invitedById: true,
      workspace: { select: { id: true, name: true } },
    },
  });
  if (!invitation) {
    return NextResponse.json({ error: "Invalid invitation link" }, { status: 404 });
  }

  const assessment = assessInvitation(invitation, user.email);
  if (!assessment.valid) {
    return NextResponse.json({ error: REASON_MESSAGES[assessment.reason] }, { status: 410 });
  }

  // Accepting from a brand-new account: make sure the profile row exists
  // before the membership references it.
  await getOrCreateProfile(user);

  const alreadyMember = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
    select: { id: true },
  });

  if (!alreadyMember) {
    // Re-check the seat at accept time: the accepted invitation converts its
    // own pending seat into a member seat, so only members count here.
    const entitlements = await getEntitlements(invitation.workspaceId);
    const members = await prisma.workspaceMember.count({
      where: { workspaceId: invitation.workspaceId },
    });
    const seat = canAddSeat(members, 0, entitlements.plan.limits.seats);
    if (!seat.allowed) {
      return NextResponse.json(
        { error: "This workspace has no free seats left. Ask the owner to upgrade the plan." },
        { status: 402 }
      );
    }

    await prisma.$transaction([
      prisma.workspaceMember.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: invitation.role,
        },
      }),
      prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
  } else {
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });
  }

  await recordAudit(invitation.workspaceId, user.id, "member.joined", {
    email: user.email,
    role: invitation.role,
  });
  await notifyWorkspaceEvent(
    user.id,
    `You joined ${invitation.workspace.name}`,
    `You now have ${invitation.role.toLowerCase()} access to the "${invitation.workspace.name}" workspace.`,
    "/dashboard"
  );
  await notifyWorkspaceEvent(
    invitation.invitedById,
    "Invitation accepted",
    `${user.email} joined the "${invitation.workspace.name}" workspace.`
  );

  // Switch straight into the new workspace.
  const response = NextResponse.json({ workspace: invitation.workspace });
  response.cookies.set(WORKSPACE_COOKIE, invitation.workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
