import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { isPlayNotificationsConfigured, playPackageName } from "@/lib/billing/play/config";
import {
  classifyDeveloperNotification,
  notificationPackageMatches,
  parsePubsubEnvelope,
  verifyPubsubPush,
} from "@/lib/billing/play/notifications";
import { playNotificationName } from "@/lib/billing/play/state";
import { syncPlayPurchaseFromNotification } from "@/lib/billing/play/sync";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/workspace/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/billing/play/notifications`
 *
 * Google Play Real-time Developer Notifications, delivered as Google Cloud
 * Pub/Sub push messages.
 *
 * This route is public — Google presents no Ballast session — so the OIDC token
 * on the push is the only thing standing between a stranger and a free
 * subscription. It is verified against Google's published keys with the audience
 * the push subscription was configured with, and a request that fails is answered
 * 401 without touching the database.
 *
 * The payload is used only to learn which purchase token changed.  What changed
 * about it is re-read from `purchases.subscriptionsv2.get`; nothing in the
 * notification is trusted as a statement of state, which is Google's own
 * guidance.  See https://developer.android.com/google/play/billing/lifecycle
 *
 * Status codes are chosen for Pub/Sub's retry behaviour, which retries anything
 * that is not a 2xx:
 *
 *   200/202  processed, or permanently unprocessable — stop redelivering
 *   401      the push could not be authenticated
 *   503      this server has no Play configuration
 *   500      a transient failure, please redeliver
 */
export async function POST(request: Request) {
  try {
    if (!isPlayNotificationsConfigured()) {
      return NextResponse.json(
        {
          error: "Google Play notifications are not configured on this server.",
          code: "PLAY_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    const auth = await verifyPubsubPush(request.headers.get("authorization"));
    if (!auth.ok) {
      // The reason is logged, never returned: an attacker probing this endpoint
      // learns only that it refused them.
      logger.warn("play_push_rejected", { reason: auth.reason });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const envelope = parsePubsubEnvelope(await request.json().catch(() => null));
    if (!envelope) {
      logger.warn("play_push_malformed");
      return NextResponse.json({ ignored: "malformed" }, { status: 202 });
    }

    const packageName = playPackageName();
    if (!notificationPackageMatches(envelope.notification, packageName)) {
      logger.warn("play_push_wrong_package", {
        received: envelope.notification.packageName,
      });
      return NextResponse.json({ ignored: "wrong_package" }, { status: 202 });
    }

    const classified = classifyDeveloperNotification(envelope.notification);

    if (classified.kind === "test") {
      logger.info("play_push_test_notification", { messageId: envelope.messageId });
      return NextResponse.json({ ok: true, test: true });
    }
    if (classified.kind === "ignored") {
      logger.info("play_push_ignored", { reason: classified.reason });
      return NextResponse.json({ ignored: classified.reason }, { status: 202 });
    }

    const isVoided = classified.kind === "voided";
    const notificationType = isVoided ? null : classified.notificationType;
    const outcome = await syncPlayPurchaseFromNotification({
      purchaseToken: classified.purchaseToken,
      notificationType,
      // A voided purchase is a refund or a chargeback, and SUBSCRIPTION_REVOKED
      // is a refund: both cut access at once rather than at period end.
      revoked: isVoided || (classified.kind === "subscription" && classified.revoked),
    });

    if (!outcome.handled) {
      if (outcome.reason === "lookup_failed") {
        // Transient: ask Pub/Sub to redeliver rather than losing the event.
        return NextResponse.json({ error: "Retry" }, { status: 500 });
      }
      if (outcome.reason === "not_configured") {
        return NextResponse.json({ error: "Not configured" }, { status: 503 });
      }
      // A token with no local row cannot be attributed to a workspace: the
      // obfuscated identifiers Google echoes are one-way hashes. The client's
      // next resume reconciliation presents it to /verify, which creates the row.
      logger.warn("play_push_unattributed", {
        reason: outcome.reason,
        notificationType,
      });
      return NextResponse.json({ ignored: outcome.reason }, { status: 202 });
    }

    await recordAudit(outcome.workspaceId, null, "billing.play_notification", {
      notification: isVoided ? "VOIDED_PURCHASE" : playNotificationName(notificationType ?? -1),
      notificationType,
      refundType: isVoided ? classified.refundType : undefined,
      state: outcome.state,
      plan: outcome.planId,
      entitling: outcome.entitling,
      messageId: envelope.messageId,
    });

    return NextResponse.json({
      ok: true,
      state: outcome.state,
      entitling: outcome.entitling,
    });
  } catch (error) {
    // A 500 here means Pub/Sub retries, which is what an unexpected fault wants.
    return apiError(
      "POST /api/billing/play/notifications",
      "Could not process the Play notification",
      error
    );
  }
}
