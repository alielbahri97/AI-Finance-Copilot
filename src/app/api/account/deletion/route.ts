import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/response";
import {
  ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
  activeSubscriptions,
  assessReauthentication,
  assessWorkspaces,
  DELETION_CONFIRMATION_PHRASE,
  deletionScheduledFor,
  hashEmail,
  recordAccountAudit,
  REAUTHENTICATION_MAX_AGE_SECONDS,
  sendDeletionRequestedEmail,
  serializeDeletionRequest,
} from "@/lib/account/deletion";
import { resolveRequestUser } from "@/lib/auth/request";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * The in-app account deletion mechanism, reachable from the web app, the
 * Android client (Bearer) and the public /delete-account page.
 *
 *   GET    — the current request, or { request: null }
 *   POST   — schedule a deletion after a typed confirmation
 *   DELETE — cancel a scheduled deletion
 *
 * User-scoped, not workspace-scoped: deleting an account is not something a
 * workspace permission grants, so this authenticates with resolveRequestUser
 * rather than requireWorkspace.
 */

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  confirm: z.literal(DELETION_CONFIRMATION_PHRASE, {
    error: `Type ${DELETION_CONFIRMATION_PHRASE} to confirm that you want your account deleted.`,
  }),
  reason: z.string().trim().max(1_000).optional(),
});

/** Why a re-authentication check failed, in words a client can show. */
const REAUTH_MESSAGE =
  "For your security, sign in again before deleting your account. " +
  `This confirmation expires ${Math.round(REAUTHENTICATION_MAX_AGE_SECONDS / 60)} minutes after you sign in.`;

export async function GET(request: Request) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const row = await prisma.accountDeletionRequest.findFirst({
      where: { userId: user.id },
      orderBy: { requestedAt: "desc" },
    });

    return NextResponse.json({
      request: row ? serializeDeletionRequest(row) : null,
      gracePeriodDays: ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
    });
  } catch (error) {
    return apiError("GET /api/account/deletion", "Could not load the deletion status", error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid request",
          code: "INVALID_CONFIRMATION",
        },
        { status: 400 }
      );
    }

    const reauth = await assessReauthentication(user.id, request);
    if (!reauth.ok) {
      logger.warn("account_deletion_reauth_rejected", {
        userId: user.id,
        failure: reauth.failure,
      });
      return NextResponse.json(
        { error: REAUTH_MESSAGE, code: "REAUTH_REQUIRED" },
        { status: 401 }
      );
    }

    // Idempotent: a client that retries, or a user who taps the button on two
    // devices, gets the request that already exists rather than a second one.
    const existing = await prisma.accountDeletionRequest.findFirst({
      where: { userId: user.id, status: "SCHEDULED" },
      orderBy: { requestedAt: "desc" },
    });
    if (existing) {
      const disposition = await assessWorkspaces(user.id);
      return NextResponse.json({
        request: serializeDeletionRequest(existing),
        alreadyScheduled: true,
        warnings: {
          activeSubscriptions: await activeSubscriptions(
            disposition.soleOccupancy.map((w) => w.id)
          ),
          workspacesToDelete: disposition.soleOccupancy,
        },
      });
    }

    const disposition = await assessWorkspaces(user.id);
    if (disposition.blocking.length > 0) {
      return NextResponse.json(
        {
          error:
            "You are the only owner of a workspace that other people are still in. " +
            "Transfer ownership or remove the other members first, then delete your account.",
          code: "SOLE_OWNER",
          workspaces: disposition.blocking,
        },
        { status: 409 }
      );
    }

    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { email: true },
    });
    const email = profile?.email ?? user.email ?? null;
    if (!email) {
      // Without an address there is nothing to hash into the retained record
      // and nobody to warn that a deletion is pending.
      return NextResponse.json(
        { error: "This account has no email address on file.", code: "NO_EMAIL" },
        { status: 409 }
      );
    }

    const requestedAt = new Date();
    const scheduledFor = deletionScheduledFor(requestedAt);
    const created = await prisma.accountDeletionRequest.create({
      data: {
        userId: user.id,
        emailHash: hashEmail(email),
        status: "SCHEDULED",
        reason: parsed.data.reason || null,
        requestedAt,
        scheduledFor,
      },
    });

    const subscriptions = await activeSubscriptions(disposition.soleOccupancy.map((w) => w.id));

    await recordAccountAudit(user.id, "account.deletion_requested", {
      requestId: created.id,
      scheduledFor: scheduledFor.toISOString(),
      workspacesToDelete: disposition.soleOccupancy.map((w) => w.id),
    });
    await sendDeletionRequestedEmail(email, scheduledFor);

    logger.info("account_deletion_requested", {
      requestId: created.id,
      scheduledFor: scheduledFor.toISOString(),
      workspacesToDelete: disposition.soleOccupancy.length,
      reauthBasis: reauth.basis,
    });

    return NextResponse.json({
      request: serializeDeletionRequest(created),
      warnings: {
        activeSubscriptions: subscriptions,
        workspacesToDelete: disposition.soleOccupancy,
      },
    });
  } catch (error) {
    return apiError("POST /api/account/deletion", "Could not schedule the deletion", error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await resolveRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.accountDeletionRequest.findFirst({
      where: { userId: user.id, status: "SCHEDULED" },
      orderBy: { requestedAt: "desc" },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "There is no scheduled deletion to cancel.", code: "NOT_SCHEDULED" },
        { status: 404 }
      );
    }

    const cancelled = await prisma.accountDeletionRequest.update({
      where: { id: existing.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), reason: null },
    });

    await recordAccountAudit(user.id, "account.deletion_cancelled", { requestId: cancelled.id });
    logger.info("account_deletion_cancelled", { requestId: cancelled.id });

    return NextResponse.json({ request: serializeDeletionRequest(cancelled) });
  } catch (error) {
    return apiError("DELETE /api/account/deletion", "Could not cancel the deletion", error);
  }
}
