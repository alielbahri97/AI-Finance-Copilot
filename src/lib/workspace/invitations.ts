/**
 * Invitation token logic — pure and testable. Only the SHA-256 hash of the
 * token is stored; the raw token exists solely in the emailed invite link.
 */
import { createHash, randomBytes } from "node:crypto";

export const INVITATION_TTL_DAYS = 7;

/** Random URL-safe token for the invite link (256 bits of entropy). */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export interface InvitationState {
  email: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Pending = still usable and still consuming a seat. Mirrors the where-clause
 * used for the pending-invitation queries.
 */
export function isPendingInvitation(
  invitation: Pick<InvitationState, "expiresAt" | "acceptedAt" | "revokedAt">,
  now = new Date()
): boolean {
  return (
    invitation.acceptedAt === null &&
    invitation.revokedAt === null &&
    invitation.expiresAt.getTime() > now.getTime()
  );
}

export interface RegenerationPlan {
  /** The raw token — goes into the new link and is never persisted. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
  /** Stamped on the superseded invitation so its old link stops working. */
  revokedAt: Date;
}

/**
 * A pending invite's raw token only ever existed in the original link, so it
 * cannot be shown again. Getting a fresh link therefore means replacing the
 * invitation: revoke the old one and issue a new token with a new expiry. The
 * seat count is unaffected — the old row stops being pending as the new one
 * starts.
 */
export function planInvitationRegeneration(now = new Date()): RegenerationPlan {
  const token = generateInviteToken();
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: invitationExpiry(now),
    revokedAt: now,
  };
}

export type InvitationAssessment =
  | { valid: true }
  | { valid: false; reason: "accepted" | "revoked" | "expired" | "email_mismatch" };

/**
 * Single-use, revocable, time-boxed and email-bound: the invited email must
 * match the accepting account's email (case-insensitive).
 */
export function assessInvitation(
  invitation: InvitationState,
  accepterEmail: string,
  now = new Date()
): InvitationAssessment {
  if (invitation.acceptedAt) return { valid: false, reason: "accepted" };
  if (invitation.revokedAt) return { valid: false, reason: "revoked" };
  if (invitation.expiresAt.getTime() <= now.getTime()) return { valid: false, reason: "expired" };
  if (invitation.email.trim().toLowerCase() !== accepterEmail.trim().toLowerCase()) {
    return { valid: false, reason: "email_mismatch" };
  }
  return { valid: true };
}

/** Seat-limit math: can the workspace take one more member? */
export function canAddSeat(
  currentMembers: number,
  pendingInvitations: number,
  seatLimit: number | null
): { allowed: boolean; seatsUsed: number; seatLimit: number | null } {
  const seatsUsed = currentMembers + pendingInvitations;
  if (seatLimit === null) return { allowed: true, seatsUsed, seatLimit };
  return { allowed: seatsUsed < seatLimit, seatsUsed, seatLimit };
}
