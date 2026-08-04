import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { sanitizeWorkspaceId, WORKSPACE_COOKIE } from "@/lib/workspace/context";

const switchSchema = z.object({ workspaceId: z.string().min(1).max(64) });

/**
 * Switches the current workspace. The cookie is only a hint — membership is
 * still re-verified on every subsequent request — but we verify here too so
 * the switcher can't even appear to work for a non-member.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = switchSchema.safeParse(await request.json().catch(() => null));
  const workspaceId = parsed.success ? sanitizeWorkspaceId(parsed.data.workspaceId) : null;
  if (!workspaceId) {
    return NextResponse.json({ error: "Invalid workspace id" }, { status: 400 });
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { workspace: { select: { id: true, name: true } } },
  });
  if (!membership) {
    return NextResponse.json({ error: "You are not a member of that workspace." }, { status: 403 });
  }

  const response = NextResponse.json({ workspace: membership.workspace });
  response.cookies.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
