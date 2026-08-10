import "server-only";

import { createHash } from "node:crypto";

import type { AccountDeletionRequest, AccountDeletionStatus } from "@/generated/prisma/client";
import { timestamp, timestampOrNull, type TimestampString } from "@/lib/api/wire";
import type { HeaderCarrier } from "@/lib/auth/request";
import { verifySupabaseAccessToken, type SupabaseJwtClaims } from "@/lib/auth/bearer";
import { extractBearerToken } from "@/lib/auth/token";
import { playPackageName } from "@/lib/billing/play/config";
import { playManagementUrl } from "@/lib/billing/play/products";
import { playEntitlement } from "@/lib/billing/play/state";
import { getStripe, isBillingConfigured } from "@/lib/billing/stripe";
import { decryptSecret } from "@/lib/integrations/crypto";
import { getProviderHooks } from "@/lib/integrations/providers";
import { logger, serializeError } from "@/lib/logger";
import { isEmailConfigured, renderAlertEmail, sendEmail } from "@/lib/notifications/email";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAudit, type AuditAction } from "@/lib/workspace/audit";

/**
 * Account deletion: the policy checks a request has to pass, and the executor
 * that erases the account once the grace period is over.
 *
 * This is a Google Play submission gate (Play policy "Data deletion"), which
 * wants a real deletion mechanism in the app AND a public URL that works
 * without installing it. Both entry points land here, so there is exactly one
 * definition of what "deleted" means.
 *
 * The shape of the thing: a request is not a deletion. It schedules one for
 * seven days out and can be cancelled by the account holder until the sweep
 * picks it up. That window is the only defence a hijacked account has — an
 * attacker who deletes it outright leaves nothing to restore, while one who
 * schedules it leaves an email in the victim's inbox and a week to act.
 */

/* ------------------------------------------------------------------ */
/* Policy constants                                                    */
/* ------------------------------------------------------------------ */

/** How long a scheduled deletion can still be cancelled by its owner. */
export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How recently the caller must have authenticated for a deletion request to
 * be accepted. Fifteen minutes is the usual "sudo mode" window: long enough to
 * cover a sign-in followed by some navigating, short enough that an unattended
 * logged-in device is not a deletion waiting to happen.
 */
export const REAUTHENTICATION_MAX_AGE_SECONDS = 15 * 60;

/** Clock drift allowance, matching the Bearer verifier's tolerance. */
const REAUTH_CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Failed executions are retried by the next sweep. After this many attempts
 * the row is parked as FAILED so it stops consuming the run budget and starts
 * showing up as something a human has to look at.
 */
export const MAX_DELETION_ATTEMPTS = 5;

/** The literal a caller has to type to confirm. */
export const DELETION_CONFIRMATION_PHRASE = "DELETE";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * The only form of the address that survives a deletion. Enough to answer
 * "was this address deleted, and when" for a support or regulator question
 * without keeping personal data we just promised to erase.
 */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** End of the grace period for a request made at `from`. */
export function deletionScheduledFor(from: Date = new Date()): Date {
  return new Date(from.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_DAYS * DAY_MS);
}

export interface DeletionRequestWire {
  id: string;
  status: AccountDeletionStatus;
  reason: string | null;
  requestedAt: TimestampString;
  scheduledFor: TimestampString;
  cancelledAt: TimestampString | null;
  completedAt: TimestampString | null;
  gracePeriodDays: number;
}

/** Wire shape of a request row. Never carries the email, only its hash. */
export function serializeDeletionRequest(row: AccountDeletionRequest): DeletionRequestWire {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    requestedAt: timestamp(row.requestedAt),
    scheduledFor: timestamp(row.scheduledFor),
    cancelledAt: timestampOrNull(row.cancelledAt),
    completedAt: timestampOrNull(row.completedAt),
    gracePeriodDays: ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
  };
}

/* ------------------------------------------------------------------ */
/* Re-authentication                                                   */
/* ------------------------------------------------------------------ */

export type ReauthenticationFailure =
  | "no_token"
  | "unverifiable"
  | "subject_mismatch"
  | "no_auth_time"
  | "stale";

export type ReauthenticationResult =
  | { ok: true; authenticatedAt: Date; basis: "amr" | "iat" }
  | { ok: false; failure: ReauthenticationFailure };

/**
 * Reads the session's own record of when the user last proved who they are.
 *
 * Supabase stamps an `amr` array on the access token — one entry per
 * authentication method used on this session, each with the unix second it
 * happened. That timestamp belongs to the SESSION, not to the token, so it
 * does not move when the access token is refreshed, which is exactly the
 * property a sudo-mode check needs.
 *
 * `iat` is the fallback for tokens without `amr`, and it is a much weaker
 * signal: it is the moment the token was issued or refreshed, so it proves
 * possession of a refresh token rather than presentation of a credential.
 */
function authTimeFromClaims(claims: SupabaseJwtClaims): { at: number; basis: "amr" | "iat" } | null {
  const amr = (claims as { amr?: unknown }).amr;
  if (Array.isArray(amr)) {
    let latest: number | null = null;
    for (const entry of amr) {
      const value = (entry as { timestamp?: unknown } | null)?.timestamp;
      if (typeof value === "number" && Number.isFinite(value)) {
        latest = latest === null ? value : Math.max(latest, value);
      }
    }
    if (latest !== null) return { at: latest, basis: "amr" };
  }
  if (typeof claims.iat === "number" && Number.isFinite(claims.iat)) {
    return { at: claims.iat, basis: "iat" };
  }
  return null;
}

/**
 * The caller's access token, from either identification scheme. Bearer clients
 * hand it over directly; the web app's lives in the Supabase cookie session.
 * Both are verified below before anything is read out of them.
 */
async function callerAccessToken(request?: HeaderCarrier): Promise<string | null> {
  const fromHeader = extractBearerToken(request?.headers.get("authorization"));
  if (fromHeader) return fromHeader;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Requires that the caller authenticated recently, as evidence that the person
 * asking for the deletion is the account holder and not whoever found the
 * device unlocked.
 */
export async function assessReauthentication(
  userId: string,
  request?: HeaderCarrier,
  now: Date = new Date()
): Promise<ReauthenticationResult> {
  const token = await callerAccessToken(request);
  if (!token) return { ok: false, failure: "no_token" };

  let claims: SupabaseJwtClaims;
  try {
    claims = await verifySupabaseAccessToken(token);
  } catch (error) {
    logger.warn("account_deletion_reauth_unverifiable", { error: serializeError(error).message });
    return { ok: false, failure: "unverifiable" };
  }

  // The token has to belong to the user the request is being made for. Without
  // this a valid token for account A could authorise the deletion of account B
  // if any caller ever mixed the two up.
  if (claims.sub !== userId) return { ok: false, failure: "subject_mismatch" };

  const authTime = authTimeFromClaims(claims);
  if (!authTime) return { ok: false, failure: "no_auth_time" };

  const ageSeconds = now.getTime() / 1000 - authTime.at;
  if (ageSeconds > REAUTHENTICATION_MAX_AGE_SECONDS) return { ok: false, failure: "stale" };
  // A timestamp from the future is a clock problem, not a fresh login.
  if (ageSeconds < -REAUTH_CLOCK_TOLERANCE_SECONDS) return { ok: false, failure: "stale" };

  return { ok: true, authenticatedAt: new Date(authTime.at * 1000), basis: authTime.basis };
}

/* ------------------------------------------------------------------ */
/* Workspace disposition                                               */
/* ------------------------------------------------------------------ */

export interface WorkspaceSummary {
  id: string;
  name: string;
  memberCount: number;
}

export interface WorkspaceDisposition {
  /**
   * Workspaces the user is the last OWNER of while other people are still in
   * them. Deleting the account would leave these unmanageable, so a request is
   * refused until ownership moves or the members go.
   */
  blocking: WorkspaceSummary[];
  /** Workspaces nobody else occupies. These are deleted with the account. */
  soleOccupancy: WorkspaceSummary[];
  /** Workspaces that survive because other members and other owners remain. */
  surviving: WorkspaceSummary[];
}

/**
 * Sorts every workspace the user belongs to into the three cases that matter.
 * Two queries, grouped in memory, rather than a count per workspace.
 */
export async function assessWorkspaces(userId: string): Promise<WorkspaceDisposition> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: { workspaceId: true, workspace: { select: { id: true, name: true } } },
  });
  const workspaceIds = memberships.map((m) => m.workspaceId);
  const disposition: WorkspaceDisposition = { blocking: [], soleOccupancy: [], surviving: [] };
  if (workspaceIds.length === 0) return disposition;

  const allMembers = await prisma.workspaceMember.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { workspaceId: true, userId: true, role: true },
  });

  for (const membership of memberships) {
    const members = allMembers.filter((m) => m.workspaceId === membership.workspaceId);
    const summary: WorkspaceSummary = {
      id: membership.workspace.id,
      name: membership.workspace.name,
      memberCount: members.length,
    };
    const others = members.filter((m) => m.userId !== userId);
    if (others.length === 0) {
      disposition.soleOccupancy.push(summary);
      continue;
    }
    const isOwner = members.some((m) => m.userId === userId && m.role === "OWNER");
    const otherOwners = others.filter((m) => m.role === "OWNER");
    if (isOwner && otherOwners.length === 0) disposition.blocking.push(summary);
    else disposition.surviving.push(summary);
  }
  return disposition;
}

export interface SubscriptionWarning {
  workspaceId: string;
  workspaceName: string;
  plan: string;
  status: string;
  currentPeriodEnd: TimestampString | null;
}

/**
 * Paid subscriptions attached to workspaces that are about to disappear. This
 * never blocks the deletion — it is reported so the client can say "this also
 * cancels your subscription" before the user commits, and the executor cancels
 * it at Stripe for real.
 */
export async function activeSubscriptions(
  workspaceIds: string[]
): Promise<SubscriptionWarning[]> {
  if (workspaceIds.length === 0) return [];
  const rows = await prisma.subscription.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      stripeSubscriptionId: { not: null },
      status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
    },
    select: {
      workspaceId: true,
      plan: true,
      status: true,
      currentPeriodEnd: true,
      workspace: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    workspaceName: row.workspace?.name ?? row.workspaceId,
    plan: row.plan,
    status: row.status,
    currentPeriodEnd: timestampOrNull(row.currentPeriodEnd),
  }));
}

export interface PlaySubscriptionWarning {
  workspaceId: string;
  workspaceName: string;
  plan: string;
  productId: string;
  /** Play's own state string. */
  state: string;
  expiresAt: TimestampString | null;
  /** Where the user has to go to cancel it, because the server cannot. */
  manageUrl: string | null;
}

/**
 * Google Play subscriptions on workspaces about to disappear.
 *
 * Reported separately from the Stripe ones because the remedy is different, and
 * the difference is the whole point: **a Play subscription cannot be cancelled
 * server-side.** There is no such call in the Google Play Developer API — only
 * the subscriber can cancel, from the Play Store — so deleting the account would
 * otherwise leave a live monthly charge for a product that no longer exists.
 *
 * The choice made here is to surface it, loudly, at every step: in the warnings
 * before the user commits, in the deletion email, and as an error-level log line
 * when the deletion executes. Blocking the deletion on it was the alternative and
 * is worse — a deletion request must not be refusable on the strength of a
 * third-party billing state, which is exactly the kind of thing Play's own data
 * deletion policy exists to prevent.
 */
export async function activePlaySubscriptions(
  workspaceIds: string[]
): Promise<PlaySubscriptionWarning[]> {
  if (workspaceIds.length === 0) return [];
  const packageName = playPackageName();
  const now = new Date();
  const rows = await prisma.playPurchase.findMany({
    where: { workspaceId: { in: workspaceIds }, retiredAt: null, revokedAt: null },
    select: {
      workspaceId: true,
      plan: true,
      productId: true,
      state: true,
      expiryTime: true,
      workspace: { select: { name: true } },
    },
  });
  return rows
    .filter(
      (row) =>
        playEntitlement({ state: row.state, expiryTime: row.expiryTime, now }).entitling
    )
    .map((row) => ({
      workspaceId: row.workspaceId,
      workspaceName: row.workspace?.name ?? row.workspaceId,
      plan: row.plan,
      productId: row.productId,
      state: row.state,
      expiresAt: timestampOrNull(row.expiryTime),
      manageUrl: packageName ? playManagementUrl(row.productId, packageName) : null,
    }));
}

/**
 * Records a security event in every workspace the user is still a member of.
 * An account disappearing is the other members' business too, and in the
 * workspaces that survive it is the only trace left of who left and why.
 */
export async function recordAccountAudit(
  userId: string,
  action: AuditAction,
  detail?: Record<string, unknown>,
  workspaceIds?: string[]
): Promise<void> {
  try {
    const ids =
      workspaceIds ??
      (
        await prisma.workspaceMember.findMany({
          where: { userId },
          select: { workspaceId: true },
        })
      ).map((m) => m.workspaceId);
    for (const workspaceId of ids) {
      await recordAudit(workspaceId, userId, action, detail);
    }
  } catch (error) {
    logger.error("account_deletion_audit_failed", { action, error: serializeError(error) });
  }
}

/* ------------------------------------------------------------------ */
/* Notification mail                                                   */
/* ------------------------------------------------------------------ */

/** Best-effort mail. An email problem never changes what happens to the data. */
async function notify(
  email: string | null,
  subject: string,
  html: string,
  channel: string
): Promise<void> {
  if (!email || !isEmailConfigured()) return;
  try {
    const result = await sendEmail(email, subject, html, channel);
    if (result.status === "failed") {
      logger.warn("account_deletion_email_failed", { channel, error: result.error });
    }
  } catch (error) {
    logger.warn("account_deletion_email_threw", { channel, error: serializeError(error) });
  }
}

export async function sendDeletionRequestedEmail(
  email: string | null,
  scheduledFor: Date
): Promise<void> {
  await notify(
    email,
    "Your Ballast account is scheduled for deletion",
    renderAlertEmail({
      title: "Your account is scheduled for deletion",
      bodyText:
        `We received a request to delete your Ballast account. Nothing has been erased yet.\n\n` +
        `Your account and its data will be permanently deleted after ${ACCOUNT_DELETION_GRACE_PERIOD_DAYS} days. ` +
        `Until then you can stop it, and everything stays exactly as it is.\n\n` +
        `If you did not ask for this, cancel it now and change your password — someone else may have access to your account.`,
      details: [{ label: "Scheduled for", value: scheduledFor.toUTCString() }],
      ctaLabel: "Cancel the deletion",
      ctaPath: "/delete-account",
    }),
    "account-deletion"
  );
}

export async function sendDeletionCompletedEmail(
  email: string | null,
  /** True when a Google Play subscription is still live and only the user can stop it. */
  playSubscriptionNeedsCancelling = false
): Promise<void> {
  await notify(
    email,
    "Your Ballast account has been deleted",
    renderAlertEmail({
      title: "Your account has been deleted",
      bodyText:
        "Your Ballast account and the financial data in it have been permanently deleted. " +
        "This cannot be undone and there is nothing left to restore.\n\n" +
        (playSubscriptionNeedsCancelling
          ? "One thing is left for you to do. Your subscription was bought through Google Play, " +
            "and Google only lets the subscriber cancel it — we cannot do it for you. " +
            "Open the Play Store, go to Payments and subscriptions, then Subscriptions, and cancel Ballast, " +
            "or you will keep being charged for it.\n\n"
          : "") +
        "We keep a record that a deletion happened, holding only a one-way hash of your email address, " +
        "and audit entries in shared workspaces that still belong to other people. Those no longer name you.\n\n" +
        "You are welcome back any time — a new account starts empty.",
      ctaLabel: "Create a new account",
      ctaPath: "/signup",
    }),
    "account-deletion"
  );
}

/* ------------------------------------------------------------------ */
/* The executor                                                        */
/* ------------------------------------------------------------------ */

export interface DeletionOutcome {
  requestId: string;
  status: "COMPLETED" | "RETRY" | "FAILED";
  revokedConnections: number;
  revocationFailures: number;
  cancelledSubscriptions: number;
  /**
   * Live Google Play subscriptions on the workspaces that were deleted. Not
   * cancelled — they cannot be, from a server — only reported, so the user is
   * told to cancel them in the Play Store and support has a record if they don't.
   */
  playSubscriptionsToCancel: number;
  deletedWorkspaces: number;
  orphanedWorkspaces: string[];
  authUserDeleted: boolean;
  error?: string;
}

/** Withdraws bank/OAuth consent at each provider before the rows disappear. */
async function revokeConnections(userId: string): Promise<{ revoked: number; failed: number }> {
  let revoked = 0;
  let failed = 0;
  const connections = await prisma.integrationConnection.findMany({ where: { userId } });
  for (const connection of connections) {
    const hooks = getProviderHooks(connection.provider);
    if (!hooks.revoke) continue;
    let token: string | null = null;
    try {
      token = connection.accessToken ? decryptSecret(connection.accessToken) : null;
    } catch {
      token = null;
    }
    try {
      await hooks.revoke(connection, token);
      revoked += 1;
    } catch (error) {
      failed += 1;
      logger.error("account_deletion_revoke_failed", {
        provider: connection.provider,
        connectionId: connection.id,
        error: serializeError(error),
      });
    }
  }
  return { revoked, failed };
}

/**
 * Cancels the Stripe subscriptions of the workspaces that are about to be
 * deleted, so nobody is billed for a workspace that no longer exists.
 *
 * Only those workspaces: a subscription on a workspace that survives belongs
 * to the members who stay, even if this user is the one who set it up.
 *
 * A Stripe outage must not strand the deletion, so every failure is logged and
 * swallowed. The cost of that trade is a subscription that may keep billing
 * until someone notices, which is a support problem; the alternative is an
 * account that cannot be deleted because a third party is down, which is a
 * policy violation.
 */
async function cancelSubscriptions(workspaceIds: string[]): Promise<number> {
  if (workspaceIds.length === 0 || !isBillingConfigured()) return 0;
  const stripe = getStripe();
  if (!stripe) return 0;

  let cancelled = 0;
  try {
    const rows = await prisma.subscription.findMany({
      where: { workspaceId: { in: workspaceIds }, stripeSubscriptionId: { not: null } },
      select: { workspaceId: true, stripeSubscriptionId: true },
    });
    for (const row of rows) {
      if (!row.stripeSubscriptionId) continue;
      try {
        await stripe.subscriptions.cancel(row.stripeSubscriptionId);
        cancelled += 1;
      } catch (error) {
        logger.error("account_deletion_stripe_cancel_failed", {
          workspaceId: row.workspaceId,
          subscriptionId: row.stripeSubscriptionId,
          error: serializeError(error),
        });
      }
    }
  } catch (error) {
    logger.error("account_deletion_stripe_lookup_failed", { error: serializeError(error) });
  }
  return cancelled;
}

/**
 * Removes the Supabase Auth user, which is what actually stops the credentials
 * from working.
 *
 * Best-effort by necessity: it needs the service-role key, and a deployment
 * that has not set one must still get its data erased. When this returns false
 * the data is gone but the login is not, and that is logged as an error
 * because it needs a human to finish.
 */
async function deleteAuthUser(userId: string): Promise<boolean> {
  const client = createServiceClient();
  if (!client) {
    logger.error("account_deletion_auth_user_not_removed", {
      userId,
      reason: "SUPABASE_SERVICE_ROLE_KEY is not configured",
    });
    return false;
  }
  try {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) {
      logger.error("account_deletion_auth_user_not_removed", { userId, reason: error.message });
      return false;
    }
    return true;
  } catch (error) {
    logger.error("account_deletion_auth_user_not_removed", {
      userId,
      reason: serializeError(error).message,
    });
    return false;
  }
}

/**
 * Erases one account. Idempotent at every step, because a run that dies
 * halfway is retried by the next sweep rather than rolled back.
 *
 * The order is deliberate:
 *
 *   1. revoke bank/OAuth consents, while the tokens still exist to revoke with;
 *   2. cancel Stripe subscriptions, while the ids are still readable;
 *   3. write the audit entry in the workspaces that survive, while the user id
 *      is still a valid foreign key;
 *   4. delete solely-occupied workspaces;
 *   5. delete the Profile, which cascades everything user-owned;
 *   6. delete the Supabase Auth user;
 *   7. mark the request COMPLETED.
 *
 * Steps 1, 2, 6 and the mail are best-effort and can never fail the run.
 * Steps 4 and 5 are the deletion itself: if either throws, the request keeps
 * its SCHEDULED status with an incremented attempt count and the next sweep
 * picks it up again.
 */
export async function executeAccountDeletion(
  request: AccountDeletionRequest
): Promise<DeletionOutcome> {
  const userId = request.userId;
  const outcome: DeletionOutcome = {
    requestId: request.id,
    status: "COMPLETED",
    revokedConnections: 0,
    revocationFailures: 0,
    cancelledSubscriptions: 0,
    playSubscriptionsToCancel: 0,
    deletedWorkspaces: 0,
    orphanedWorkspaces: [],
    authUserDeleted: false,
  };

  try {
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    const disposition = await assessWorkspaces(userId);
    // Membership can change during the grace period, so the sole-ownership
    // rule is re-evaluated here rather than trusted from request time. A
    // workspace that became blocking is NOT deleted — other people's data is
    // not collateral — but the account still goes, which leaves that workspace
    // without an owner. Loud on purpose: it needs a human to hand it over.
    if (disposition.blocking.length > 0) {
      outcome.orphanedWorkspaces = disposition.blocking.map((w) => w.id);
      logger.error("account_deletion_left_workspace_without_owner", {
        userId,
        workspaces: disposition.blocking.map((w) => ({ id: w.id, name: w.name })),
      });
    }

    const revocation = await revokeConnections(userId);
    outcome.revokedConnections = revocation.revoked;
    outcome.revocationFailures = revocation.failed;

    const soleOccupancyIds = disposition.soleOccupancy.map((w) => w.id);
    outcome.cancelledSubscriptions = await cancelSubscriptions(soleOccupancyIds);

    // Play subscriptions cannot be cancelled from here, so they are recorded
    // before the rows cascade away with their workspace. Error level on purpose:
    // it means a real person is still being charged for a product they no longer
    // have, and the only remedy runs through the Play Store or a Play Console
    // refund somebody has to issue by hand.
    const playSubscriptions = await activePlaySubscriptions(soleOccupancyIds).catch(() => []);
    outcome.playSubscriptionsToCancel = playSubscriptions.length;
    if (playSubscriptions.length > 0) {
      logger.error("account_deletion_play_subscription_not_cancellable", {
        userId,
        requestId: request.id,
        subscriptions: playSubscriptions.map((subscription) => ({
          workspaceId: subscription.workspaceId,
          productId: subscription.productId,
          state: subscription.state,
          expiresAt: subscription.expiresAt,
        })),
      });
    }

    // Written before the Profile goes: the row keeps the workspace's history
    // intact, and the cascade's SetNull on user_id is what anonymises it.
    const survivingIds = [...disposition.surviving, ...disposition.blocking].map((w) => w.id);
    if (survivingIds.length > 0) {
      await recordAccountAudit(userId, "account.deleted", { requestId: request.id }, survivingIds);
    }

    if (soleOccupancyIds.length > 0) {
      const deleted = await prisma.workspace.deleteMany({ where: { id: { in: soleOccupancyIds } } });
      outcome.deletedWorkspaces = deleted.count;
    }

    await prisma.profile.deleteMany({ where: { id: userId } });

    outcome.authUserDeleted = await deleteAuthUser(userId);

    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        // The free-text reason is the last personal data on this row; the row
        // itself survives, so the reason must not.
        reason: null,
        lastError: null,
        attempts: { increment: 1 },
      },
    });

    await sendDeletionCompletedEmail(
      profile?.email ?? null,
      outcome.playSubscriptionsToCancel > 0
    );

    logger.info("account_deletion_completed", {
      requestId: request.id,
      deletedWorkspaces: outcome.deletedWorkspaces,
      cancelledSubscriptions: outcome.cancelledSubscriptions,
      playSubscriptionsToCancel: outcome.playSubscriptionsToCancel,
      revokedConnections: outcome.revokedConnections,
      revocationFailures: outcome.revocationFailures,
      authUserDeleted: outcome.authUserDeleted,
      orphanedWorkspaces: outcome.orphanedWorkspaces.length,
    });
    return outcome;
  } catch (error) {
    const attempts = request.attempts + 1;
    const exhausted = attempts >= MAX_DELETION_ATTEMPTS;
    const message = serializeError(error).message.slice(0, 500);
    outcome.status = exhausted ? "FAILED" : "RETRY";
    outcome.error = message;
    logger.error("account_deletion_failed", {
      requestId: request.id,
      attempts,
      exhausted,
      error: serializeError(error),
    });
    try {
      await prisma.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          attempts,
          lastError: message,
          // Still SCHEDULED means still due, so the next sweep retries it.
          ...(exhausted ? { status: "FAILED" as const } : {}),
        },
      });
    } catch (updateError) {
      logger.error("account_deletion_bookkeeping_failed", {
        requestId: request.id,
        error: serializeError(updateError),
      });
    }
    return outcome;
  }
}

/* ------------------------------------------------------------------ */
/* The sweep                                                           */
/* ------------------------------------------------------------------ */

/**
 * Next only accepts a literal for a route's `maxDuration`, so the ceiling is
 * written twice; a test asserts the two copies still agree.
 */
export const ACCOUNT_DELETION_MAX_DURATION_SECONDS = 300;

/**
 * Headroom kept back so the run can finish the account it is on and answer the
 * cron, instead of being killed with a profile deleted and no COMPLETED row.
 */
export const ACCOUNT_DELETION_RUN_RESERVE_MS = 60_000;

export const ACCOUNT_DELETION_RUN_BUDGET_MS =
  ACCOUNT_DELETION_MAX_DURATION_SECONDS * 1_000 - ACCOUNT_DELETION_RUN_RESERVE_MS;

/** How many due requests one run will even look at. */
export const ACCOUNT_DELETION_BATCH_SIZE = 50;

export interface SweepStats {
  due: number;
  completed: number;
  retryable: number;
  failed: number;
  /** Due requests the run had no budget left for. The next run takes them. */
  deferred: number;
}

export interface SweepOptions {
  now?: Date;
  budgetMs?: number;
  startedAt?: number;
}

/**
 * Executes every deletion whose grace period has expired, oldest first, until
 * the budget runs out. Nothing here is time-critical to the minute: a request
 * that misses today's run is executed tomorrow.
 */
export async function runAccountDeletionSweep(options: SweepOptions = {}): Promise<SweepStats> {
  const now = options.now ?? new Date();
  const startedAt = options.startedAt ?? Date.now();
  const budgetMs = options.budgetMs ?? ACCOUNT_DELETION_RUN_BUDGET_MS;

  const dueRequests = await prisma.accountDeletionRequest.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: ACCOUNT_DELETION_BATCH_SIZE,
  });

  const stats: SweepStats = {
    due: dueRequests.length,
    completed: 0,
    retryable: 0,
    failed: 0,
    deferred: 0,
  };

  for (const request of dueRequests) {
    // Checked before starting an account, never during one: a deletion is
    // interrupted only by the platform, never by our own bookkeeping.
    if (Date.now() - startedAt > budgetMs) {
      stats.deferred = stats.due - stats.completed - stats.retryable - stats.failed;
      logger.warn("account_deletion_sweep_out_of_budget", { deferred: stats.deferred });
      break;
    }
    const outcome = await executeAccountDeletion(request);
    if (outcome.status === "COMPLETED") stats.completed += 1;
    else if (outcome.status === "FAILED") stats.failed += 1;
    else stats.retryable += 1;
  }

  return stats;
}
