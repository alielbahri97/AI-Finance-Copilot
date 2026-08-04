/**
 * The workspace permission matrix — pure logic, shared by server enforcement,
 * UI gating and tests.
 *
 * A member's effective permissions = role defaults, then per-member overrides
 * (granting or revoking individual permissions). Owners always have every
 * permission; overrides are ignored for them so a workspace can never lock
 * out its owner.
 */

export type WorkspaceRoleName = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export const ALL_PERMISSIONS = [
  "view_transactions",
  "edit_transactions",
  "view_invoices",
  "edit_invoices",
  "view_reports",
  "export_data",
  "use_copilot",
  "manage_forecast",
  "manage_integrations",
  "view_billing",
  "manage_members",
  "manage_settings",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

/** Human labels for the Team settings toggles. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  view_transactions: "View transactions",
  edit_transactions: "Edit transactions & imports",
  view_invoices: "View invoices",
  edit_invoices: "Edit invoices",
  view_reports: "View reports & dashboard",
  export_data: "Export data",
  use_copilot: "Use the AI copilot",
  manage_forecast: "Manage forecast assumptions",
  manage_integrations: "Manage integrations",
  view_billing: "View billing",
  manage_members: "Manage members",
  manage_settings: "Manage workspace settings",
};

const VIEWER_PERMISSIONS: Permission[] = ["view_transactions", "view_invoices", "view_reports"];

const MEMBER_PERMISSIONS: Permission[] = [
  ...VIEWER_PERMISSIONS,
  "edit_transactions",
  "edit_invoices",
  "export_data",
  "use_copilot",
  "manage_forecast",
];

/** Role defaults. OWNER/ADMIN: everything; MEMBER: edit-level without member/
 *  billing/integration management; VIEWER: read-only. */
export const ROLE_DEFAULT_PERMISSIONS: Record<WorkspaceRoleName, readonly Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS,
  MEMBER: MEMBER_PERMISSIONS,
  VIEWER: VIEWER_PERMISSIONS,
};

/** Per-member overrides as stored in WorkspaceMember.permissions (JSON). */
export type PermissionOverrides = Partial<Record<Permission, boolean>>;

function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/** Parses the JSON column defensively; unknown keys and non-booleans are dropped. */
export function parseOverrides(raw: unknown): PermissionOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const overrides: PermissionOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isPermission(key) && typeof value === "boolean") overrides[key] = value;
  }
  return overrides;
}

/**
 * Effective permission set for a member: role defaults + overrides.
 * Overrides are ignored for OWNER so owners can never be locked out.
 */
export function resolvePermissions(
  role: WorkspaceRoleName,
  overrides?: unknown
): Set<Permission> {
  const permissions = new Set<Permission>(ROLE_DEFAULT_PERMISSIONS[role]);
  if (role === "OWNER") return permissions;

  const parsed = parseOverrides(overrides);
  for (const [permission, granted] of Object.entries(parsed) as [Permission, boolean][]) {
    if (granted) permissions.add(permission);
    else permissions.delete(permission);
  }
  return permissions;
}

export function hasPermission(
  role: WorkspaceRoleName,
  overrides: unknown,
  permission: Permission
): boolean {
  return resolvePermissions(role, overrides).has(permission);
}

/**
 * Which roles an actor may assign. Admins cannot mint owners or demote them;
 * only an owner can transfer ownership (not exposed in the UI yet).
 */
export function assignableRoles(actorRole: WorkspaceRoleName): WorkspaceRoleName[] {
  if (actorRole === "OWNER") return ["ADMIN", "MEMBER", "VIEWER"];
  if (actorRole === "ADMIN") return ["ADMIN", "MEMBER", "VIEWER"];
  return [];
}

/** Whether `actor` may change the role/permissions of, or remove, `target`. */
export function canManageMember(
  actorRole: WorkspaceRoleName,
  targetRole: WorkspaceRoleName
): boolean {
  if (targetRole === "OWNER") return false;
  return actorRole === "OWNER" || actorRole === "ADMIN";
}
