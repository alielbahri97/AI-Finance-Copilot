import { describe, expect, it } from "vitest";

import { sanitizeWorkspaceId } from "@/lib/workspace/context";
import {
  assessInvitation,
  canAddSeat,
  generateInviteToken,
  hashInviteToken,
  invitationExpiry,
  INVITATION_TTL_DAYS,
  isPendingInvitation,
  planInvitationRegeneration,
} from "@/lib/workspace/invitations";
import {
  ALL_PERMISSIONS,
  assignableRoles,
  canManageMember,
  hasPermission,
  parseOverrides,
  resolvePermissions,
} from "@/lib/workspace/permissions";

/* ------------------------------------------------------------------ */
/* Permission matrix                                                   */
/* ------------------------------------------------------------------ */

describe("permission matrix", () => {
  it("grants owners and admins every permission", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const permissions = resolvePermissions(role);
      for (const permission of ALL_PERMISSIONS) {
        expect(permissions.has(permission)).toBe(true);
      }
    }
  });

  it("gives members edit-level access without member/billing management", () => {
    const permissions = resolvePermissions("MEMBER");
    expect(permissions.has("edit_transactions")).toBe(true);
    expect(permissions.has("edit_invoices")).toBe(true);
    expect(permissions.has("use_copilot")).toBe(true);
    expect(permissions.has("manage_members")).toBe(false);
    expect(permissions.has("view_billing")).toBe(false);
    expect(permissions.has("manage_integrations")).toBe(false);
    expect(permissions.has("manage_settings")).toBe(false);
  });

  it("gives viewers read-only access", () => {
    const permissions = resolvePermissions("VIEWER");
    expect(permissions.has("view_transactions")).toBe(true);
    expect(permissions.has("view_invoices")).toBe(true);
    expect(permissions.has("view_reports")).toBe(true);
    expect(permissions.has("edit_transactions")).toBe(false);
    expect(permissions.has("export_data")).toBe(false);
    expect(permissions.has("use_copilot")).toBe(false);
  });

  it("applies grant and revoke overrides on top of role defaults", () => {
    const permissions = resolvePermissions("VIEWER", {
      use_copilot: true,
      view_invoices: false,
    });
    expect(permissions.has("use_copilot")).toBe(true);
    expect(permissions.has("view_invoices")).toBe(false);
    expect(permissions.has("view_transactions")).toBe(true);
  });

  it("ignores overrides for owners so they can never be locked out", () => {
    const permissions = resolvePermissions("OWNER", { manage_members: false });
    expect(permissions.has("manage_members")).toBe(true);
  });

  it("drops unknown keys and non-boolean values from stored overrides", () => {
    expect(parseOverrides({ nonsense: true, view_reports: "yes", export_data: false })).toEqual({
      export_data: false,
    });
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides([true])).toEqual({});
    expect(parseOverrides("view_reports")).toEqual({});
  });

  it("answers point checks through hasPermission", () => {
    expect(hasPermission("MEMBER", null, "edit_transactions")).toBe(true);
    expect(hasPermission("MEMBER", { edit_transactions: false }, "edit_transactions")).toBe(false);
  });

  it("restricts role assignment and member management by actor role", () => {
    expect(assignableRoles("OWNER")).toEqual(["ADMIN", "MEMBER", "VIEWER"]);
    expect(assignableRoles("ADMIN")).toEqual(["ADMIN", "MEMBER", "VIEWER"]);
    expect(assignableRoles("MEMBER")).toEqual([]);
    expect(assignableRoles("VIEWER")).toEqual([]);

    expect(canManageMember("OWNER", "ADMIN")).toBe(true);
    expect(canManageMember("ADMIN", "MEMBER")).toBe(true);
    // Nobody can manage the owner.
    expect(canManageMember("ADMIN", "OWNER")).toBe(false);
    expect(canManageMember("OWNER", "OWNER")).toBe(false);
    expect(canManageMember("MEMBER", "VIEWER")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

describe("invitation tokens", () => {
  it("generates unique URL-safe tokens and stores only their hash", () => {
    const first = generateInviteToken();
    const second = generateInviteToken();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[\w-]+$/);
    expect(first.length).toBeGreaterThanOrEqual(40);

    const hash = hashInviteToken(first);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashInviteToken(first)); // deterministic lookup key
    expect(hash).not.toContain(first);
  });

  it("expires after seven days", () => {
    const now = new Date("2026-08-04T12:00:00Z");
    const expiry = invitationExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  });
});

describe("invitation acceptance", () => {
  const base = {
    email: "Partner@Example.com",
    expiresAt: new Date("2026-08-11T12:00:00Z"),
    acceptedAt: null,
    revokedAt: null,
  };
  const now = new Date("2026-08-04T12:00:00Z");

  it("accepts a valid invitation with a case-insensitive email match", () => {
    expect(assessInvitation(base, "partner@example.com", now)).toEqual({ valid: true });
    expect(assessInvitation(base, "  PARTNER@EXAMPLE.COM  ", now)).toEqual({ valid: true });
  });

  it("is single-use", () => {
    expect(
      assessInvitation({ ...base, acceptedAt: new Date() }, "partner@example.com", now)
    ).toEqual({ valid: false, reason: "accepted" });
  });

  it("rejects revoked invitations", () => {
    expect(
      assessInvitation({ ...base, revokedAt: new Date() }, "partner@example.com", now)
    ).toEqual({ valid: false, reason: "revoked" });
  });

  it("rejects expired invitations (boundary inclusive)", () => {
    expect(assessInvitation(base, "partner@example.com", base.expiresAt)).toEqual({
      valid: false,
      reason: "expired",
    });
    expect(
      assessInvitation(base, "partner@example.com", new Date("2026-09-01T00:00:00Z"))
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects a different accepting email", () => {
    expect(assessInvitation(base, "intruder@example.com", now)).toEqual({
      valid: false,
      reason: "email_mismatch",
    });
  });
});

/* ------------------------------------------------------------------ */
/* Regenerating an invite link                                         */
/* ------------------------------------------------------------------ */

describe("invitation link regeneration", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const original = {
    email: "partner@example.com",
    role: "MEMBER" as const,
    tokenHash: hashInviteToken("original-token"),
    expiresAt: new Date("2026-08-06T12:00:00Z"),
    acceptedAt: null as Date | null,
    revokedAt: null as Date | null,
  };

  it("issues a fresh token, stores only its hash, and resets the expiry", () => {
    const plan = planInvitationRegeneration(now);

    expect(plan.token).toMatch(/^[\w-]+$/);
    expect(plan.tokenHash).toBe(hashInviteToken(plan.token));
    expect(plan.tokenHash).not.toBe(original.tokenHash);
    // The raw token must never be recoverable from what gets persisted.
    expect(plan.tokenHash).not.toContain(plan.token);
    expect(plan.expiresAt).toEqual(invitationExpiry(now));
    expect(plan.expiresAt.getTime()).toBeGreaterThan(original.expiresAt.getTime());
  });

  it("revokes the superseded invitation so its old link stops working", () => {
    const plan = planInvitationRegeneration(now);
    const superseded = { ...original, revokedAt: plan.revokedAt };

    expect(plan.revokedAt).toEqual(now);
    expect(isPendingInvitation(superseded, now)).toBe(false);
    expect(assessInvitation(superseded, original.email, now)).toEqual({
      valid: false,
      reason: "revoked",
    });
  });

  it("does not double-count the seat: exactly one of the two rows stays pending", () => {
    const plan = planInvitationRegeneration(now);
    const rows = [
      { ...original, revokedAt: plan.revokedAt },
      { ...original, tokenHash: plan.tokenHash, expiresAt: plan.expiresAt },
    ];

    const pending = rows.filter((row) => isPendingInvitation(row, now));
    expect(pending).toHaveLength(1);
    expect(pending[0].tokenHash).toBe(plan.tokenHash);
    expect(canAddSeat(1, pending.length, 2)).toEqual({
      allowed: false,
      seatsUsed: 2,
      seatLimit: 2,
    });
  });

  it("counts an accepted or expired invitation as no longer pending", () => {
    expect(isPendingInvitation(original, now)).toBe(true);
    expect(isPendingInvitation({ ...original, acceptedAt: now }, now)).toBe(false);
    expect(isPendingInvitation(original, new Date("2026-08-07T12:00:00Z"))).toBe(false);
    expect(isPendingInvitation(original, original.expiresAt)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Seat limits                                                         */
/* ------------------------------------------------------------------ */

describe("seat limits", () => {
  it("counts members plus pending invitations against the plan seats", () => {
    expect(canAddSeat(1, 0, 1)).toEqual({ allowed: false, seatsUsed: 1, seatLimit: 1 });
    expect(canAddSeat(1, 0, 5)).toEqual({ allowed: true, seatsUsed: 1, seatLimit: 5 });
    expect(canAddSeat(3, 2, 5)).toEqual({ allowed: false, seatsUsed: 5, seatLimit: 5 });
    expect(canAddSeat(3, 1, 5)).toEqual({ allowed: true, seatsUsed: 4, seatLimit: 5 });
  });

  it("treats a null limit as unlimited (Enterprise)", () => {
    expect(canAddSeat(500, 20, null)).toEqual({ allowed: true, seatsUsed: 520, seatLimit: null });
  });
});

/* ------------------------------------------------------------------ */
/* Workspace cookie validation                                         */
/* ------------------------------------------------------------------ */

describe("workspace cookie validation", () => {
  it("accepts well-formed ids", () => {
    expect(sanitizeWorkspaceId("ws-123e4567-e89b-12d3-a456-426614174000")).toBe(
      "ws-123e4567-e89b-12d3-a456-426614174000"
    );
    expect(sanitizeWorkspaceId("  clx1abc2def3  ")).toBe("clx1abc2def3");
  });

  it("rejects missing, oversized or malformed values", () => {
    expect(sanitizeWorkspaceId(undefined)).toBeNull();
    expect(sanitizeWorkspaceId(null)).toBeNull();
    expect(sanitizeWorkspaceId("")).toBeNull();
    expect(sanitizeWorkspaceId("   ")).toBeNull();
    expect(sanitizeWorkspaceId("a".repeat(65))).toBeNull();
    expect(sanitizeWorkspaceId("ws-1'; DROP TABLE workspaces;--")).toBeNull();
    expect(sanitizeWorkspaceId("ws 1")).toBeNull();
    expect(sanitizeWorkspaceId("ws/../1")).toBeNull();
  });
});
