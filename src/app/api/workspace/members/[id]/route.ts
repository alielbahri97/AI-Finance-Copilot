import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";
import { notifyWorkspaceEvent } from "@/lib/workspace/team";
import {
  ALL_PERMISSIONS,
  assignableRoles,
  canManageMember,
} from "@/lib/workspace/permissions";

const updateSchema = z
  .object({
    role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).optional(),
    /** Per-permission overrides; missing keys fall back to the role default. */
    permissions: z.record(z.enum(ALL_PERMISSIONS), z.boolean()).optional(),
  })
  .refine((value) => value.role !== undefined || value.permissions !== undefined, {
    message: "Nothing to update",
  });

type RouteContext = { params: Promise<{ id: string }> };

/** Changes a member's role and/or per-permission overrides. */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireWorkspace("manage_members");
  if (!auth.ok) return auth.response;
  const { user, workspace } = auth.ctx;
  const { id } = await context.params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const target = await prisma.workspaceMember.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, userId: true, role: true, profile: { select: { email: true } } },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (target.userId === user.id) {
    return NextResponse.json(
      { error: "You can't change your own role or permissions." },
      { status: 400 }
    );
  }
  if (!canManageMember(auth.ctx.role, target.role)) {
    return NextResponse.json(
      { error: "You can't manage this member." },
      { status: 403 }
    );
  }
  if (parsed.data.role && !assignableRoles(auth.ctx.role).includes(parsed.data.role)) {
    return NextResponse.json({ error: "You can't assign that role." }, { status: 403 });
  }

  await prisma.workspaceMember.update({
    where: { id: target.id },
    data: {
      ...(parsed.data.role ? { role: parsed.data.role } : {}),
      ...(parsed.data.permissions !== undefined ? { permissions: parsed.data.permissions } : {}),
    },
  });

  if (parsed.data.role && parsed.data.role !== target.role) {
    await recordAudit(workspace.id, user.id, "member.role_changed", {
      member: target.profile.email,
      from: target.role,
      to: parsed.data.role,
    });
    await notifyWorkspaceEvent(
      target.userId,
      `Your role in ${workspace.name} changed`,
      `You are now ${parsed.data.role.toLowerCase()} in the "${workspace.name}" workspace.`
    );
  }
  if (parsed.data.permissions !== undefined) {
    await recordAudit(workspace.id, user.id, "member.permissions_changed", {
      member: target.profile.email,
      overrides: parsed.data.permissions,
    });
  }

  return NextResponse.json({ ok: true });
}

/** Removes a member. Their session loses access on the very next request. */
export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireWorkspace("manage_members");
  if (!auth.ok) return auth.response;
  const { user, workspace } = auth.ctx;
  const { id } = await context.params;

  const target = await prisma.workspaceMember.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, userId: true, role: true, profile: { select: { email: true } } },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (target.userId === user.id) {
    return NextResponse.json(
      { error: "You can't remove yourself. Use \"Leave workspace\" instead." },
      { status: 400 }
    );
  }
  if (!canManageMember(auth.ctx.role, target.role)) {
    return NextResponse.json({ error: "You can't remove this member." }, { status: 403 });
  }

  await prisma.workspaceMember.delete({ where: { id: target.id } });
  await recordAudit(workspace.id, user.id, "member.removed", { member: target.profile.email });
  await notifyWorkspaceEvent(
    target.userId,
    `Removed from ${workspace.name}`,
    `You no longer have access to the "${workspace.name}" workspace.`,
    "/dashboard"
  );

  return NextResponse.json({ ok: true });
}
