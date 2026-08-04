import "server-only";
import { cache } from "react";

import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { Workspace, WorkspaceRole } from "@/generated/prisma/client";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

import { personalWorkspaceId } from "./ids";
import { resolvePermissions, type Permission } from "./permissions";

export { personalWorkspaceId };

/**
 * Holds the id of the user's currently selected workspace. The cookie is a
 * hint only — membership is re-verified against the database on every request
 * (a removed member instantly loses access, and a forged cookie is useless).
 */
export const WORKSPACE_COOKIE = "ballast_workspace";

/**
 * The pre-rebrand cookie name. Still read (never written) so a session that
 * started before the rename keeps the workspace it had selected.
 */
export const LEGACY_WORKSPACE_COOKIE = "fp_workspace";

/** Cookie ids are attacker-controlled input; cap before hitting the DB. */
const MAX_WORKSPACE_ID_LENGTH = 64;

export interface WorkspaceContext {
  user: User;
  workspace: Workspace;
  role: WorkspaceRole;
  memberId: string;
  permissions: Set<Permission>;
}

/** Validates a cookie value before it is used in a lookup. */
export function sanitizeWorkspaceId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.length > MAX_WORKSPACE_ID_LENGTH) return null;
  return /^[\w-]+$/.test(value) ? value : null;
}

type MembershipWithWorkspace = {
  id: string;
  role: WorkspaceRole;
  permissions: unknown;
  workspace: Workspace;
};

async function findMembership(
  userId: string,
  workspaceId: string
): Promise<MembershipWithWorkspace | null> {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true, role: true, permissions: true, workspace: true },
  });
}

async function findDefaultMembership(userId: string): Promise<MembershipWithWorkspace | null> {
  // Prefer the personal workspace, then the oldest membership.
  const personal = await findMembership(userId, personalWorkspaceId(userId));
  if (personal) return personal;
  return prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    select: { id: true, role: true, permissions: true, workspace: true },
  });
}

/**
 * THE security core: resolves the authenticated user and their currently
 * selected workspace, verifying membership in the database on every request.
 * Every API route and server-side data fetch that touches business data must
 * go through this (or requireWorkspace below). Per-request memoized.
 *
 * Returns null when there is no authenticated user.
 */
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext | null> => {
  const user = await getUser();
  if (!user) return null;

  const store = await cookies();
  const requested = sanitizeWorkspaceId(
    store.get(WORKSPACE_COOKIE)?.value ?? store.get(LEGACY_WORKSPACE_COOKIE)?.value
  );

  let membership = requested ? await findMembership(user.id, requested) : null;
  if (!membership) membership = await findDefaultMembership(user.id);

  if (!membership) {
    // Fresh signup whose first request skipped the dashboard layout: create
    // the profile + personal workspace, then resolve again.
    await getOrCreateProfile(user);
    membership = await findDefaultMembership(user.id);
    if (!membership) return null;
  }

  return {
    user,
    workspace: membership.workspace,
    role: membership.role,
    memberId: membership.id,
    permissions: resolvePermissions(membership.role, membership.permissions),
  };
});

export type WorkspaceAuthResult =
  | { ok: true; ctx: WorkspaceContext }
  | { ok: false; response: NextResponse };

/**
 * API-route guard: 401 without a session, 403 when the member lacks any of
 * the required permissions. Usage:
 *
 *   const auth = await requireWorkspace("edit_transactions");
 *   if (!auth.ok) return auth.response;
 *   const { user, workspace } = auth.ctx;
 */
export async function requireWorkspace(
  ...required: Permission[]
): Promise<WorkspaceAuthResult> {
  const ctx = await getWorkspaceContext();
  if (!ctx) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  for (const permission of required) {
    if (!ctx.permissions.has(permission)) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: "You don't have permission to do this in the current workspace.",
            code: "FORBIDDEN",
            permission,
          },
          { status: 403 }
        ),
      };
    }
  }
  return { ok: true, ctx };
}

/** All workspaces the user belongs to, for the workspace switcher. */
export async function listUserWorkspaces(userId: string) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    select: {
      role: true,
      workspace: { select: { id: true, name: true } },
    },
  });
  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    role: m.role,
  }));
}
