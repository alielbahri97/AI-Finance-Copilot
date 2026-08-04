import { NextResponse } from "next/server";
import { z } from "zod";

import { getEntitlements } from "@/lib/billing/entitlements";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";
import {
  canAddSeat,
  generateInviteToken,
  hashInviteToken,
  invitationExpiry,
} from "@/lib/workspace/invitations";
import { assignableRoles } from "@/lib/workspace/permissions";
import { countSeats, sendInvitationEmail } from "@/lib/workspace/team";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
});

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/** Invites someone by email. Seats are enforced against the workspace plan. */
export async function POST(request: Request) {
  const auth = await requireWorkspace("manage_members");
  if (!auth.ok) return auth.response;
  const { user, workspace } = auth.ctx;

  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { email, role } = parsed.data;

  if (!assignableRoles(auth.ctx.role).includes(role)) {
    return NextResponse.json({ error: "You can't assign that role." }, { status: 403 });
  }
  if (email === user.email?.toLowerCase()) {
    return NextResponse.json({ error: "You are already a member." }, { status: 400 });
  }

  /* ---- Seat limit from the workspace plan ---- */
  const entitlements = await getEntitlements(workspace.id);
  const { members, pending } = await countSeats(workspace.id);
  const seat = canAddSeat(members, pending, entitlements.plan.limits.seats);
  if (!seat.allowed) {
    return NextResponse.json(
      {
        error: `Your ${entitlements.plan.name} plan includes ${seat.seatLimit} seat${seat.seatLimit === 1 ? "" : "s"} and all are in use. Upgrade on the Billing page to invite more people.`,
        code: "UPGRADE_REQUIRED",
        feature: "Workspace seats",
        plan: entitlements.planId,
      },
      { status: 402 }
    );
  }

  /* ---- No duplicates ---- */
  const existingMember = await prisma.workspaceMember.findFirst({
    where: { workspaceId: workspace.id, profile: { email: { equals: email, mode: "insensitive" } } },
    select: { id: true },
  });
  if (existingMember) {
    return NextResponse.json({ error: "That person is already a member." }, { status: 409 });
  }
  const existingInvite = await prisma.workspaceInvitation.findFirst({
    where: {
      workspaceId: workspace.id,
      email: { equals: email, mode: "insensitive" },
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (existingInvite) {
    return NextResponse.json(
      { error: "There is already a pending invitation for that email. Revoke it first to re-invite." },
      { status: 409 }
    );
  }

  /* ---- Create (only the hash is stored) ---- */
  const token = generateInviteToken();
  const invitation = await prisma.workspaceInvitation.create({
    data: {
      workspaceId: workspace.id,
      email,
      role,
      tokenHash: hashInviteToken(token),
      expiresAt: invitationExpiry(),
      invitedById: user.id,
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
  await recordAudit(workspace.id, user.id, "member.invited", { email, role });

  const inviteLink = appUrl(`/invite/${token}`);
  const inviterName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "A teammate";
  const emailSent = await sendInvitationEmail({
    email,
    workspaceName: workspace.name,
    inviterName,
    inviteLink,
  });

  // The raw token appears only in this response and the email — never stored.
  return NextResponse.json({ invitation, inviteLink, emailSent }, { status: 201 });
}
