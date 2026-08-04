import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/workspace/audit";
import {
  getWorkspaceContext,
  LEGACY_WORKSPACE_COOKIE,
  WORKSPACE_COOKIE,
} from "@/lib/workspace/context";

/** Leaves the current workspace. Owners can't leave their own workspace. */
export async function POST() {
  const ctx = await getWorkspaceContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role === "OWNER") {
    return NextResponse.json(
      { error: "Owners can't leave their own workspace." },
      { status: 400 }
    );
  }

  await prisma.workspaceMember.delete({ where: { id: ctx.memberId } });
  await recordAudit(ctx.workspace.id, ctx.user.id, "member.left", {
    member: ctx.user.email,
  });

  // Drop the cookie so the next request falls back to the personal workspace.
  // The pre-rebrand cookie goes too, or it would resurrect the selection.
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(WORKSPACE_COOKIE);
  response.cookies.delete(LEGACY_WORKSPACE_COOKIE);
  return response;
}
