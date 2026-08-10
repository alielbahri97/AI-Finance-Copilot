import "server-only";
import { cache } from "react";

import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { Workspace, WorkspaceRole } from "@/generated/prisma/client";
import {
  requestedWorkspaceHeader,
  resolveRequestUser,
  WORKSPACE_HEADER,
  type HeaderCarrier,
} from "@/lib/auth/request";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";

import {
  applyEditionPermissions,
  editionForWorkspaceType,
  editionHasFeature,
  type EditionFeature,
} from "./editions";
import { personalWorkspaceId } from "./ids";
import { resolvePermissions, type Permission } from "./permissions";

export { personalWorkspaceId, WORKSPACE_HEADER };
export type { HeaderCarrier };

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
  /**
   * The member's permissions, already narrowed to what the workspace's edition
   * supports. A Personal workspace never carries `view_invoices` or
   * `manage_members`, so every existing `requireWorkspace(...)` call became an
   * edition guard for free.
   */
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
 * The workspace the caller is asking for, in preference order:
 *
 *   1. the `X-Ballast-Workspace` header, for clients that cannot set cookies;
 *   2. the selection cookie, which is what the web app has always used;
 *   3. nothing, leaving the caller to fall back to the default workspace.
 *
 * Every source is attacker-controlled and every source goes through the same
 * sanitisation. None of them grants anything: the id is only ever used to look
 * up a membership row, which is what actually decides access.
 */
async function requestedWorkspaceId(request?: HeaderCarrier): Promise<string | null> {
  const fromHeader = sanitizeWorkspaceId(await requestedWorkspaceHeader(request));
  if (fromHeader) return fromHeader;

  try {
    const store = await cookies();
    return sanitizeWorkspaceId(
      store.get(WORKSPACE_COOKIE)?.value ?? store.get(LEGACY_WORKSPACE_COOKIE)?.value
    );
  } catch {
    // No cookie scope (a token-only request evaluated outside a route, a unit
    // test). The header and the default workspace still apply.
    return null;
  }
}

/**
 * THE security core: resolves the authenticated user and their currently
 * selected workspace, verifying membership in the database on every request.
 * Every API route and server-side data fetch that touches business data must
 * go through this (or requireWorkspace below). Per-request memoized.
 *
 * `request` is optional. Route handlers may pass theirs to be explicit about
 * which request is being authorized; server components have none to pass and
 * read the ambient request instead. Both paths see the same headers, so the
 * argument changes nothing but clarity — and passing it keeps the memo keyed
 * per request object rather than per render.
 *
 * Returns null when there is no authenticated user.
 */
export const getWorkspaceContext = cache(
  async (request?: HeaderCarrier): Promise<WorkspaceContext | null> => {
    const user = await resolveRequestUser(request);
    if (!user) return null;

    const requested = await requestedWorkspaceId(request);

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
      permissions: applyEditionPermissions(
        membership.workspace.type,
        resolvePermissions(membership.role, membership.permissions)
      ),
    };
  }
);

export type WorkspaceAuthResult =
  | { ok: true; ctx: WorkspaceContext }
  | { ok: false; response: NextResponse };

/** True for a Request/NextRequest, false for a Permission string. */
function isHeaderCarrier(value: unknown): value is HeaderCarrier {
  return (
    typeof value === "object" &&
    value !== null &&
    "headers" in value &&
    typeof (value as HeaderCarrier).headers?.get === "function"
  );
}

function splitGuardArgs(
  args: readonly unknown[]
): { request?: HeaderCarrier; required: Permission[] } {
  if (args.length > 0 && isHeaderCarrier(args[0])) {
    return { request: args[0], required: args.slice(1) as Permission[] };
  }
  return { required: args as Permission[] };
}

/**
 * API-route guard: 401 without a session, 403 when the member lacks any of
 * the required permissions. Usage:
 *
 *   const auth = await requireWorkspace("edit_transactions");
 *   if (!auth.ok) return auth.response;
 *   const { user, workspace } = auth.ctx;
 *
 * A route handler may pass its request first, which is what a Bearer client
 * needs for the workspace header to be read from the right place:
 *
 *   const auth = await requireWorkspace(request, "edit_transactions");
 */
export async function requireWorkspace(...required: Permission[]): Promise<WorkspaceAuthResult>;
export async function requireWorkspace(
  request: HeaderCarrier,
  ...required: Permission[]
): Promise<WorkspaceAuthResult>;
export async function requireWorkspace(
  ...args: [HeaderCarrier, ...Permission[]] | Permission[]
): Promise<WorkspaceAuthResult> {
  const { request, required } = splitGuardArgs(args);
  const ctx = await getWorkspaceContext(request);
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

/**
 * API-route guard for surfaces that only exist in one edition and have no
 * permission of their own — `/api/budgets` in a Business workspace, for
 * instance. Returns 404 rather than 403: in the wrong edition the feature does
 * not exist, and saying "forbidden" would imply it could be granted.
 */
export async function requireEditionFeature(
  feature: EditionFeature,
  ...required: Permission[]
): Promise<WorkspaceAuthResult>;
export async function requireEditionFeature(
  request: HeaderCarrier,
  feature: EditionFeature,
  ...required: Permission[]
): Promise<WorkspaceAuthResult>;
export async function requireEditionFeature(
  ...args: [HeaderCarrier, EditionFeature, ...Permission[]] | [EditionFeature, ...Permission[]]
): Promise<WorkspaceAuthResult> {
  const request = isHeaderCarrier(args[0]) ? (args[0] as HeaderCarrier) : undefined;
  const rest = (request ? args.slice(1) : args) as [EditionFeature, ...Permission[]];
  const [feature, ...required] = rest;

  const auth = request
    ? await requireWorkspace(request, ...required)
    : await requireWorkspace(...required);
  if (!auth.ok) return auth;
  if (!editionHasFeature(auth.ctx.workspace.type, feature)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "This feature is not part of the current workspace's edition.",
          code: "WRONG_EDITION",
          feature,
        },
        { status: 404 }
      ),
    };
  }
  return auth;
}

/** All workspaces the user belongs to, for the workspace switcher. */
export async function listUserWorkspaces(userId: string) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    select: {
      role: true,
      workspace: { select: { id: true, name: true, type: true } },
    },
  });
  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    type: m.workspace.type,
    edition: editionForWorkspaceType(m.workspace.type),
    role: m.role,
  }));
}
