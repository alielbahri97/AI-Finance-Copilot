import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/response";
import { ensureDefaultCategories } from "@/lib/categories";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace, WORKSPACE_COOKIE } from "@/lib/workspace/context";
import { defaultWorkspaceName, WORKSPACE_TYPES } from "@/lib/workspace/editions";

const renameSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  type: z.enum(WORKSPACE_TYPES as [string, ...string[]]).transform((value) => value as "BUSINESS" | "PERSONAL"),
});

/**
 * How many workspaces one account may own. Holding both editions is the point;
 * an unbounded loop of free workspaces is not, since each one carries its own
 * trial and quota.
 */
const MAX_OWNED_WORKSPACES = 5;

/**
 * Creates an additional workspace, of either edition, owned by the caller and
 * seeded with the default categories. This is how a business owner adds their
 * personal finances (or the reverse) without a second account: the workspace
 * switcher already handles several, and every query is workspace-scoped.
 */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Pick a workspace type" }, { status: 400 });
    }
    const { type } = parsed.data;

    const owned = await prisma.workspaceMember.count({
      where: { userId: user.id, role: "OWNER" },
    });
    if (owned >= MAX_OWNED_WORKSPACES) {
      return NextResponse.json(
        {
          error: `You can own up to ${MAX_OWNED_WORKSPACES} workspaces. Leave or delete one first.`,
        },
        { status: 400 }
      );
    }

    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { currency: true, fullName: true, email: true },
    });

    const name =
      parsed.data.name ?? defaultWorkspaceName(type, profile?.fullName, profile?.email);

    const workspace = await prisma.workspace.create({
      data: {
        name,
        type,
        currency: profile?.currency ?? "USD",
        members: { create: { userId: user.id, role: "OWNER" } },
      },
      select: { id: true, name: true, type: true },
    });

    // A workspace with no categories cannot categorise an import, so seeding is
    // part of creation — but a transient failure there must not lose the
    // workspace the user just made.
    try {
      await ensureDefaultCategories(workspace.id, user.id);
    } catch (error) {
      logger.error("[workspace] default category seed failed for new workspace", {
        workspaceId: workspace.id,
        error: serializeError(error),
      });
    }

    await recordAudit(workspace.id, user.id, "workspace.created", { type });

    // Land the user in what they just created.
    const response = NextResponse.json({ workspace }, { status: 201 });
    response.cookies.set(WORKSPACE_COOKIE, workspace.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    return apiError("POST /api/workspace", "Could not create the workspace", error);
  }
}

/** Renames the current workspace. */
export async function PATCH(request: Request) {
  const auth = await requireWorkspace("manage_settings");
  if (!auth.ok) return auth.response;
  const { user, workspace } = auth.ctx;

  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const previous = workspace.name;
  const updated = await prisma.workspace.update({
    where: { id: workspace.id },
    data: { name: parsed.data.name },
    select: { id: true, name: true },
  });
  await recordAudit(workspace.id, user.id, "workspace.renamed", {
    from: previous,
    to: updated.name,
  });

  return NextResponse.json({ workspace: updated });
}
