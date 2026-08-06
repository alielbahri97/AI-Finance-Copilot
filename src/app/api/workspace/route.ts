import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/response";
import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { ensureDefaultCategories } from "@/lib/categories";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace, WORKSPACE_COOKIE } from "@/lib/workspace/context";
import { defaultWorkspaceName, WORKSPACE_TYPES } from "@/lib/workspace/editions";
import {
  creationBlockReason,
  getWorkspaceCreationPolicy,
} from "@/lib/workspace/limits";

/**
 * Workspace-level settings the owner/admin can change. Every field is
 * optional and only what is sent is written, so the rename form and the AI
 * toggle can each PATCH the one thing they own.
 */
const settingsSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80).optional(),
    aiCategorizationEnabled: z.boolean().optional(),
    autoDunningEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Nothing to update",
  });

const createSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  type: z.enum(WORKSPACE_TYPES as [string, ...string[]]).transform((value) => value as "BUSINESS" | "PERSONAL"),
});

/**
 * Creates an additional workspace owned by the caller. Personal is capped at
 * one; mixing Business and Personal needs Enterprise or Premium. See
 * `getWorkspaceCreationPolicy`.
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

    const policy = await getWorkspaceCreationPolicy(user.id);
    const blocked = creationBlockReason(policy, type);
    if (blocked) {
      return NextResponse.json({ error: blocked, policy }, { status: 403 });
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

/** Updates the current workspace's name and/or its workspace-level settings. */
export async function PATCH(request: Request) {
  const auth = await requireWorkspace("manage_settings");
  if (!auth.ok) return auth.response;
  const { user, workspace } = auth.ctx;

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Turning automatic reminders on is the one setting here that spends the
  // product's reputation on the customer's behalf, so it carries the plan gate
  // the send routes carry. Turning it off is always allowed.
  if (parsed.data.autoDunningEnabled === true) {
    const entitlements = await getEntitlements(workspace.id);
    if (!entitlements.plan.limits.dunningEnabled) {
      return NextResponse.json(
        upgradeError("Automatic payment reminders", entitlements.planId, entitlements.edition),
        { status: 402 }
      );
    }
  }

  const previous = workspace.name;
  const updated = await prisma.workspace.update({
    where: { id: workspace.id },
    data: parsed.data,
    select: { id: true, name: true, aiCategorizationEnabled: true, autoDunningEnabled: true },
  });
  if (parsed.data.autoDunningEnabled !== undefined) {
    await recordAudit(workspace.id, user.id, "workspace.auto_dunning_changed", {
      enabled: parsed.data.autoDunningEnabled,
    });
  }
  if (parsed.data.name !== undefined && updated.name !== previous) {
    await recordAudit(workspace.id, user.id, "workspace.renamed", {
      from: previous,
      to: updated.name,
    });
  }

  return NextResponse.json({ workspace: updated });
}
