import "server-only";

import { randomBytes } from "node:crypto";

import type { PendingBankConnection } from "@/generated/prisma/client";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Server-side state for a bank connection the user is in the middle of
 * approving, shared by the web redirect flow and the native JSON flow.
 *
 * This was an httpOnly cookie holding "<requisitionId>.<reference>", which had
 * two problems. A native client has no cookie jar to keep it in — the bank's
 * consent page opens in a Custom Tab, and the app comes back with nothing but
 * the reference. And the cookie could only hold one attempt at a time, so a
 * second connection started in another tab overwrote the first and that tab's
 * callback could no longer be matched. One row per attempt, keyed by the
 * unguessable reference the provider echoes back, fixes both.
 */

/**
 * How long an attempt stays finalizable. Approving in a banking app (a push
 * notification, then a code) regularly takes longer than the 15 minutes the
 * first version of this flow allowed, so the wider window the cookie ended up
 * carrying is kept exactly as it was.
 */
export const PENDING_CONNECTION_TTL_MS = 30 * 60 * 1000;

/** The only requisition-style provider today. */
const DEFAULT_PROVIDER = "gocardless";

export interface PendingConnectionScope {
  workspaceId: string;
  userId: string;
}

export interface CreatePendingConnectionInput extends PendingConnectionScope {
  provider?: string;
  requisitionId: string;
  reference: string;
  institutionId: string;
  link: string;
}

/**
 * Mints the per-attempt nonce that is sent to the provider and echoed back as
 * `ref`.
 *
 * The `<userId>:<hex>` shape is what the cookie flow minted and is kept so an
 * attempt already in flight across a deploy still parses. Only the random half
 * carries any weight, and it is 16 bytes rather than 8 because this value is
 * now the thing a caller presents in order to finalize a connection.
 */
export function mintConnectionReference(userId: string): string {
  return `${userId}:${randomBytes(16).toString("hex")}`;
}

/**
 * Records an attempt that has just been started at the provider. The row is
 * what the callback (web) or the finalize endpoint (native) matches the
 * returning user against.
 */
export async function createPendingConnection(
  input: CreatePendingConnectionInput
): Promise<PendingBankConnection> {
  // Opportunistic housekeeping rather than a cron: rows only accumulate when
  // someone abandons a connect halfway, and starting another one is exactly
  // the moment we know they are back.
  await purgeExpiredPending(input);

  return prisma.pendingBankConnection.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: input.provider ?? DEFAULT_PROVIDER,
      requisitionId: input.requisitionId,
      reference: input.reference,
      institutionId: input.institutionId,
      link: input.link,
      expiresAt: new Date(Date.now() + PENDING_CONNECTION_TTL_MS),
    },
  });
}

async function purgeExpiredPending(scope: PendingConnectionScope): Promise<void> {
  try {
    await prisma.pendingBankConnection.deleteMany({
      where: {
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        status: "PENDING",
        expiresAt: { lt: new Date() },
      },
    });
  } catch (error) {
    // Tidying up must never be the reason a connection cannot be started.
    logger.warn("[integrations] pending connection purge failed", {
      error: serializeError(error),
    });
  }
}

export async function findPendingByReference(
  reference: string
): Promise<PendingBankConnection | null> {
  return prisma.pendingBankConnection.findUnique({ where: { reference } });
}

/**
 * Whether the attempt was started by this user in this workspace. A reference
 * is a bearer credential for one attempt, so this is what stops one user's
 * approval from being finalized into another user's workspace.
 */
export function pendingBelongsTo(
  pending: PendingBankConnection,
  scope: PendingConnectionScope
): boolean {
  return pending.workspaceId === scope.workspaceId && pending.userId === scope.userId;
}

export interface PendingConnectionRefusal {
  status: number;
  error: string;
}

/**
 * Why an attempt that belongs to the caller cannot be finalized, or null when
 * it can. Anything other than a live PENDING row is unusable: past the window
 * the requisition is gone at the provider too, a FAILED row already carries its
 * reason, and a COMPLETED row belongs to the caller's idempotent path rather
 * than being finalized a second time.
 */
export function pendingConnectionRefusal(
  pending: PendingBankConnection,
  now: Date = new Date()
): PendingConnectionRefusal | null {
  if (pending.status === "COMPLETED") {
    return { status: 409, error: "That bank connection was already completed." };
  }
  if (pending.status === "FAILED") {
    return {
      status: 410,
      error: pending.error ?? "That connection attempt failed. Start the connection again.",
    };
  }
  if (pending.expiresAt.getTime() <= now.getTime()) {
    return {
      status: 410,
      error: "The bank approval took too long and the attempt expired. Connect again.",
    };
  }
  return null;
}

/** Ties the attempt to the connection it produced, so a replay is a no-op. */
export async function markPendingCompleted(id: string, connectionId: string): Promise<void> {
  await prisma.pendingBankConnection.update({
    where: { id },
    data: { status: "COMPLETED", connectionId, completedAt: new Date(), error: null },
  });
}

/**
 * Records why an attempt could not be finalized. Never throws: the caller is
 * already handling a failure, and the message it has to deliver matters more
 * than this bookkeeping write.
 */
export async function markPendingFailed(id: string, error: string): Promise<void> {
  try {
    await prisma.pendingBankConnection.update({
      where: { id },
      data: { status: "FAILED", error: error.slice(0, 500) },
    });
  } catch (writeError) {
    logger.warn("[integrations] could not mark pending connection failed", {
      pendingId: id,
      error: serializeError(writeError),
    });
  }
}
