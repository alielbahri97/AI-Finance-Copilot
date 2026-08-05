/**
 * The two editions, as one matrix — pure logic, shared by server enforcement,
 * navigation, route guards and tests.
 *
 * Ballast ships from a single codebase as **Ballast Business** (companies) and
 * **Ballast Personal** (individuals). A workspace's `type` decides which
 * surfaces exist; everything in the shared core — transactions, categories,
 * bank connections, forecasts, the copilot, notifications, exports — works the
 * same in both.
 *
 * The rule that keeps this honest: a hidden nav link is not a guard. Gating
 * happens in three places that all read this file:
 *
 *   1. `getWorkspaceContext()` intersects the member's permissions with the
 *      edition's, so `requireWorkspace("edit_invoices")` already 403s in a
 *      Personal workspace without any route needing to know why.
 *   2. Surfaces that have no permission of their own guard on the feature:
 *      API routes through `requireEditionFeature()`, pages through
 *      `editionHasFeature()` followed by `notFound()`.
 *   3. The sidebar filters its items by the same predicate, so the UI agrees
 *      with the server instead of being the reason it is safe.
 *
 * `FEATURE_PATHS` below ties those three together: it maps a URL to the feature
 * that owns it, which is how the test suite proves the nav never offers a link
 * the server would reject.
 */

import type { Edition } from "@/lib/branding";

import { ALL_PERMISSIONS, type Permission } from "./permissions";

/** Mirrors the Prisma `WorkspaceType` enum. */
export type WorkspaceType = "BUSINESS" | "PERSONAL";

export const WORKSPACE_TYPES: readonly WorkspaceType[] = ["BUSINESS", "PERSONAL"];

/** Existing accounts and every workspace created before the Personal edition. */
export const DEFAULT_WORKSPACE_TYPE: WorkspaceType = "BUSINESS";

/**
 * Capabilities that exist in one edition and not the other. Anything shared
 * by both editions is deliberately absent: only differences belong here.
 */
export const ALL_EDITION_FEATURES = [
  /** Invoice inbox, AI extraction, VAT, payable/receivable, reminders. */
  "invoices",
  /** Vendor & customer analysis, AR/AP aging, and the report sections on them. */
  "counterparties",
  /** Multi-member sharing: members, roles, invitations, seats. */
  "team",
  /** Monthly per-category budgets with rollover. */
  "budgets",
  /** Named savings goals with contributions and a projected completion date. */
  "goals",
  /** What is owned and owed beyond the banks, and net worth over time. */
  "netWorth",
  /** Recurring-subscription detection and its cost insights. */
  "subscriptions",
  /** Accounting integrations (QuickBooks, Xero, Exact) — irrelevant to a person. */
  "accounting",
] as const;

export type EditionFeature = (typeof ALL_EDITION_FEATURES)[number];

/**
 * What each edition exposes. Business is the product exactly as it shipped —
 * nothing was taken away from it and nothing personal was added to it.
 */
export const EDITION_FEATURES: Record<WorkspaceType, readonly EditionFeature[]> = {
  BUSINESS: ["invoices", "counterparties", "team", "accounting"],
  PERSONAL: ["budgets", "goals", "netWorth", "subscriptions"],
};

/**
 * Permissions an edition can grant at all. A Personal workspace is one
 * person's own money: there is nothing to invoice and nobody to invite, so
 * those permissions are removed before any route sees them.
 */
export const EDITION_PERMISSIONS: Record<WorkspaceType, readonly Permission[]> = {
  BUSINESS: ALL_PERMISSIONS,
  PERSONAL: ALL_PERMISSIONS.filter(
    (permission) =>
      permission !== "view_invoices" &&
      permission !== "edit_invoices" &&
      permission !== "manage_members"
  ),
};

export function editionHasFeature(type: WorkspaceType, feature: EditionFeature): boolean {
  return EDITION_FEATURES[type].includes(feature);
}

/**
 * Narrows a member's effective permissions to what the edition supports.
 * Called once in the workspace context, so every `requireWorkspace(...)` and
 * every UI permission check inherits it.
 */
export function applyEditionPermissions(
  type: WorkspaceType,
  permissions: Set<Permission>
): Set<Permission> {
  const allowed = EDITION_PERMISSIONS[type];
  return new Set([...permissions].filter((permission) => allowed.includes(permission)));
}

/**
 * Paths that only exist in one edition, longest-prefix-wins. Each of those
 * pages guards itself on its feature; this map is what lets a test assert that
 * every navigable path is one the current edition's guards would allow, so the
 * two cannot drift apart.
 *
 * Three features own no route of their own and so appear empty here:
 *   * `counterparties` is a set of sections inside the shared `/reports` page,
 *     which keeps its revenue, expense and category analysis in both editions.
 *   * `team` is a section of `/settings`, gated in place. Its API routes need
 *     `manage_members`, which a Personal workspace never has.
 *   * `accounting` filters the provider grid on the shared `/integrations`.
 */
export const FEATURE_PATHS: Record<EditionFeature, readonly string[]> = {
  invoices: ["/invoices"],
  counterparties: [],
  team: [],
  budgets: ["/budgets"],
  goals: ["/goals"],
  netWorth: ["/net-worth"],
  subscriptions: ["/subscriptions"],
  accounting: [],
};

/** Which feature, if any, owns a dashboard path. */
export function featureForPath(pathname: string): EditionFeature | null {
  let match: { feature: EditionFeature; length: number } | null = null;
  for (const feature of ALL_EDITION_FEATURES) {
    for (const prefix of FEATURE_PATHS[feature]) {
      const owns = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (owns && (!match || prefix.length > match.length)) {
        match = { feature, length: prefix.length };
      }
    }
  }
  return match?.feature ?? null;
}

/** Whether a workspace of this type may open a path. Unowned paths are shared. */
export function editionAllowsPath(type: WorkspaceType, pathname: string): boolean {
  const feature = featureForPath(pathname);
  return feature === null || editionHasFeature(type, feature);
}

/** The branding edition key for a workspace type. */
export function editionForWorkspaceType(type: WorkspaceType): Edition {
  return type === "PERSONAL" ? "personal" : "business";
}

/**
 * The query-param value that carries the edition choice from the landing page
 * through signup and back out of the email-confirmation link.
 */
export const EDITION_PARAM = "for";

/** Short, URL-friendly values: `/signup?for=personal`. */
const PARAM_VALUES: Record<string, WorkspaceType> = {
  business: "BUSINESS",
  personal: "PERSONAL",
  // Accept the stored enum spelling too, so a round trip through Supabase
  // user metadata reads back the same either way.
  BUSINESS: "BUSINESS",
  PERSONAL: "PERSONAL",
};

/** Parses an untrusted `?for=` value. Anything unrecognised means Business. */
export function parseWorkspaceType(raw: string | null | undefined): WorkspaceType {
  if (!raw) return DEFAULT_WORKSPACE_TYPE;
  return PARAM_VALUES[raw.trim()] ?? DEFAULT_WORKSPACE_TYPE;
}

/** True only for an explicit, recognised choice — used to skip a needless param. */
export function isWorkspaceTypeParam(raw: string | null | undefined): boolean {
  return Boolean(raw && raw.trim() in PARAM_VALUES);
}

export function workspaceTypeParam(type: WorkspaceType): string {
  return type === "PERSONAL" ? "personal" : "business";
}

/**
 * Default name for a workspace created without one. Business keeps the naming
 * it has always had (the person's name, else their email handle); Personal is
 * just "Personal", which reads correctly next to a company name in the
 * workspace switcher.
 */
export function defaultWorkspaceName(
  type: WorkspaceType,
  displayName?: string | null,
  email?: string | null
): string {
  if (type === "PERSONAL") return "Personal";
  return displayName?.trim() || email?.split("@")[0] || "My workspace";
}

/**
 * The Supabase user-metadata key that carries the edition choice from the
 * landing page, through `supabase.auth.signUp`, across the email-confirmation
 * round trip, and into the workspace created on first login. Metadata is the
 * only carrier that survives that round trip intact — the same reason the
 * referral code travels this way.
 */
export const EDITION_METADATA_KEY = "workspace_type";
