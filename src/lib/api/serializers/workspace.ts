/**
 * Wire shaping for the workspace and its membership, shared by
 * `GET /api/session/bootstrap` and `GET /api/workspace`.
 */

import { timestamp, type TimestampString } from "@/lib/api/wire";
import {
  applyEditionPermissions,
  editionForWorkspaceType,
  type WorkspaceType,
} from "@/lib/workspace/editions";
import {
  parseOverrides,
  resolvePermissions,
  type Permission,
  type PermissionOverrides,
  type WorkspaceRoleName,
} from "@/lib/workspace/permissions";
import type { Edition } from "@/lib/branding";

export interface WorkspaceRow {
  id: string;
  name: string;
  type: WorkspaceType;
  currency: string;
  aiCategorizationEnabled: boolean;
  autoDunningEnabled: boolean;
}

export interface SerializedWorkspace {
  id: string;
  name: string;
  type: WorkspaceType;
  /** Which product this workspace runs: `"business"` or `"personal"`. */
  edition: Edition;
  currency: string;
  aiCategorizationEnabled: boolean;
  autoDunningEnabled: boolean;
}

export function serializeWorkspace(workspace: WorkspaceRow): SerializedWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    type: workspace.type,
    edition: editionForWorkspaceType(workspace.type),
    currency: workspace.currency,
    aiCategorizationEnabled: workspace.aiCategorizationEnabled,
    autoDunningEnabled: workspace.autoDunningEnabled,
  };
}

/**
 * A permission set as a stable array. Sorted rather than insertion-ordered: a
 * `Set` does not survive JSON, and a client that diffs two responses should not
 * see a change because the resolver added a permission in a different order.
 */
export function sortedPermissions(permissions: Iterable<Permission>): Permission[] {
  return [...permissions].sort();
}

export interface MemberRow {
  id: string;
  userId: string;
  role: WorkspaceRoleName;
  /** The raw per-member override JSON column. */
  permissions: unknown;
  joinedAt: Date;
  profile: { fullName: string | null; email: string };
}

export interface SerializedMember {
  id: string;
  userId: string;
  role: WorkspaceRoleName;
  fullName: string | null;
  email: string;
  /** Effective permissions: role defaults, then overrides, then the edition. */
  permissions: Permission[];
  /** Just the per-member grants and revocations, for a permissions editor. */
  overrides: PermissionOverrides;
  joinedAt: TimestampString;
}

export function serializeMember(member: MemberRow, type: WorkspaceType): SerializedMember {
  return {
    id: member.id,
    userId: member.userId,
    role: member.role,
    fullName: member.profile.fullName,
    email: member.profile.email,
    permissions: sortedPermissions(
      applyEditionPermissions(type, resolvePermissions(member.role, member.permissions))
    ),
    overrides: parseOverrides(member.permissions),
    joinedAt: timestamp(member.joinedAt),
  };
}

export interface SerializedSeats {
  /** Members plus pending invitations — what the plan's seat limit counts. */
  used: number;
  /** null = unlimited / custom. */
  limit: number | null;
  planName: string;
}
