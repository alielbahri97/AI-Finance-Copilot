import { createHash } from "node:crypto";

/**
 * The obfuscated identifiers that tie a Play purchase to a workspace.
 *
 * A Play subscription belongs to a Google account. This app bills a *workspace*,
 * and one Google account can be a member of several. The only clean mechanism
 * Play offers for closing that gap is the pair of obfuscated identifiers the
 * client sets when it launches the billing flow, which Google echoes back on
 * `externalAccountIdentifiers`:
 *
 *   obfuscatedExternalAccountId  the Supabase user id, hashed
 *   obfuscatedExternalProfileId  the workspace id, hashed
 *
 * A purchase whose identifiers do not match the caller is rejected outright
 * rather than being applied to whichever workspace happened to ask. Without that
 * check, anyone holding any valid purchase token could present it against any
 * workspace they belong to.
 *
 * Hashed rather than sent raw because Google stores these and they end up in
 * Play Console exports, and because Google's own guidance is not to put a raw
 * account identifier in them. Plain unsalted SHA-256 is enough: the inputs are a
 * v4 UUID and a cuid, so there is no dictionary to run, and using a server-side
 * secret would mean the Android client could not compute the value itself.
 *
 * Play caps both fields at 64 characters, which is exactly the length of a
 * SHA-256 digest in lower-case hex.
 *
 * The client does not have to reimplement this. `GET /api/billing/summary`
 * returns both values ready to use; the algorithm is specified so a client that
 * would rather compute them offline can, and so the server can check them.
 */

/** Lower-case hex SHA-256, which is 64 characters — Play's exact field limit. */
function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** What the client must pass as `obfuscatedAccountId`. */
export function obfuscatedAccountId(userId: string): string {
  return digest(userId);
}

/** What the client must pass as `obfuscatedProfileId`. */
export function obfuscatedProfileId(workspaceId: string): string {
  return digest(workspaceId);
}

export interface PlayIdentity {
  obfuscatedAccountId: string;
  obfuscatedProfileId: string;
}

/** Both identifiers for a (user, workspace) pair. */
export function playIdentity(userId: string, workspaceId: string): PlayIdentity {
  return {
    obfuscatedAccountId: obfuscatedAccountId(userId),
    obfuscatedProfileId: obfuscatedProfileId(workspaceId),
  };
}

export type PlayIdentityMismatch = "missing" | "account" | "profile" | null;

/**
 * Compares what Google echoed back against who is calling.
 *
 * Returns null when they match, and otherwise which half is wrong:
 *
 *   "missing"  Google returned no identifiers at all, which means the client
 *              launched the billing flow without setting them. There is nothing
 *              tying the purchase to a workspace, so it cannot be honoured.
 *   "account"  the purchase was made by a different user.
 *   "profile"  the purchase was made for a different workspace — the case that
 *              matters when one person has both a business and a personal one.
 */
export function checkPlayIdentity(
  echoed: { obfuscatedExternalAccountId?: string | null; obfuscatedExternalProfileId?: string | null } | null | undefined,
  expected: PlayIdentity
): PlayIdentityMismatch {
  const account = echoed?.obfuscatedExternalAccountId?.trim();
  const profile = echoed?.obfuscatedExternalProfileId?.trim();
  if (!account || !profile) return "missing";
  if (account !== expected.obfuscatedAccountId) return "account";
  if (profile !== expected.obfuscatedProfileId) return "profile";
  return null;
}
