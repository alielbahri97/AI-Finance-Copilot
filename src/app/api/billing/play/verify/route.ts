import { NextResponse } from "next/server";
import { z } from "zod";

import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { apiError } from "@/lib/api/response";
import { planSourceToWire } from "@/lib/api/serializers/billing";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isPlayBillingConfigured, playPackageName } from "@/lib/billing/play/config";
import { playManagementUrl } from "@/lib/billing/play/products";
import { verifyPlayPurchase, type PlayVerifyFailureCode } from "@/lib/billing/play/sync";
import { getPlan } from "@/lib/billing/plans";
import { requireWorkspace } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

/**
 * `POST /api/billing/play/verify`
 *
 * The Android client posts the purchase token Google gave it, here and on every
 * app resume after `queryPurchasesAsync`. The server checks the purchase against
 * the Google Play Developer API, confirms it was bought by this user for this
 * workspace, grants the entitlement, and acknowledges the purchase to Google.
 *
 * Acknowledgement happens here rather than in the client on purpose. Google
 * refunds and revokes an unacknowledged purchase after three days, so
 * acknowledgement is the confirmation that the entitlement was granted — doing
 * it from the client would let the two diverge, with the customer acknowledged
 * and paying while the server never recorded anything.
 *
 * Idempotent: the same token can be posted any number of times.
 */

const bodySchema = z.object({
  purchaseToken: z.string().trim().min(1).max(4096),
  /**
   * Optional, and only cross-checked against what Google reports. The truth
   * about which product was bought comes from Google, never from the client.
   */
  productId: z.string().trim().max(200).optional(),
});

/** HTTP status for each refusal, so the client can tell retry from give up. */
const STATUS_BY_CODE: Record<PlayVerifyFailureCode, number> = {
  PLAY_NOT_CONFIGURED: 503,
  PLAY_UNAVAILABLE: 502,
  PURCHASE_NOT_FOUND: 404,
  PURCHASE_IDENTIFIERS_MISSING: 400,
  PURCHASE_USER_MISMATCH: 409,
  PURCHASE_WORKSPACE_MISMATCH: 409,
  PRODUCT_NOT_OFFERED: 409,
  PURCHASE_NOT_ACTIVE: 409,
  STRIPE_SUBSCRIPTION_ACTIVE: 409,
};

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request, "view_billing");
    if (!auth.ok) return auth.response;
    const { user, workspace, role } = auth.ctx;

    // Buying a plan is an owner/admin action, exactly as Stripe checkout is.
    if (role !== "OWNER" && role !== "ADMIN") {
      return NextResponse.json(
        {
          error: "Only workspace owners and admins can change the plan.",
          code: "FORBIDDEN",
          permission: "view_billing",
        },
        { status: 403 }
      );
    }

    const limited = await enforceRateLimit("billing", user.id);
    if (limited) return limited;

    if (!isPlayBillingConfigured()) {
      return NextResponse.json(
        {
          error: "Google Play billing is not configured on this server.",
          code: "PLAY_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A purchaseToken is required.", code: "INVALID_REQUEST" },
        { status: 400 }
      );
    }

    const entitlementsBefore = await getEntitlements(workspace.id);
    const result = await verifyPlayPurchase({
      purchaseToken: parsed.data.purchaseToken,
      workspaceId: workspace.id,
      userId: user.id,
      edition: entitlementsBefore.edition,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.message,
          code: result.code,
          ...(result.state ? { state: result.state } : {}),
          ...(result.refundExpected ? { refundExpected: true } : {}),
        },
        { status: STATUS_BY_CODE[result.code] }
      );
    }

    // Re-read so the client gets the resolved entitlement rather than the tier
    // this one purchase grants: a complimentary grant or a higher Stripe plan
    // still wins, and the client should render what the workspace actually has.
    const entitlements = await getEntitlements(workspace.id);
    const packageName = playPackageName();

    return NextResponse.json({
      ok: true,
      purchase: {
        productId: result.productId,
        basePlanId: result.basePlanId,
        state: result.state,
        planId: result.planId,
        planName: getPlan(result.planId, entitlements.edition).name,
        autoRenewing: entitlements.play?.autoRenewing ?? false,
        expiresAt: result.entitlement.accessUntil?.toISOString() ?? null,
        cancelAtPeriodEnd: result.entitlement.cancelAtPeriodEnd,
        acknowledged: result.acknowledged,
        alreadyKnown: result.alreadyKnown,
      },
      entitlements: {
        planId: entitlements.planId,
        planName: entitlements.plan.name,
        planSource: planSourceToWire(entitlements.planSource),
      },
      manageUrl: packageName ? playManagementUrl(result.productId, packageName) : null,
    });
  } catch (error) {
    return apiError(
      "POST /api/billing/play/verify",
      "Could not verify that Google Play purchase",
      error
    );
  }
}
