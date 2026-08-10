import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import {
  resolvePlanSource,
  serializeEntitlements,
  serializePlan,
  serializeUsageMeters,
  type PriceSource,
} from "@/lib/api/serializers/billing";
import { serializeBillingManagement, serializePlayBlock } from "@/lib/api/serializers/play";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getPlan, planOrder } from "@/lib/billing/plans";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

/**
 * The billing screen without the Stripe invoice history, which is a second
 * network hop to Stripe and belongs in its own call.
 *
 * `plans` is only the current edition's line-up: a Personal workspace has no use
 * for seats and a Business one has no use for a €4.99 single-user tier, so
 * offering the other edition's tiers would offer something that cannot be
 * bought.
 *
 * Since Play Billing there are two more things here: `play`, which is everything
 * an Android client needs to offer an in-app purchase, and `management`, which
 * says where this workspace's plan is paid for and therefore which management
 * affordance to show — and, critically, whether purchase buttons should be shown
 * at all.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request, "view_billing");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const [entitlements, subscription, owner] = await Promise.all([
      getEntitlements(workspace.id),
      prisma.subscription.findUnique({
        where: { workspaceId: workspace.id },
        select: { stripeSubscriptionId: true },
      }),
      // A complimentary grant is keyed on the OWNER's address, not the caller's:
      // an admin looking at billing sees the plan the workspace actually has.
      prisma.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, role: "OWNER" },
        select: { profile: { select: { email: true } } },
      }),
    ]);

    const { edition } = entitlements;
    const planSource = resolvePlanSource({
      ownerEmail: owner?.profile.email,
      edition,
      planId: entitlements.planId,
      stripeSubscriptionId: subscription?.stripeSubscriptionId,
      isTrial: entitlements.isTrial,
      resolvedSource: entitlements.planSource,
    });
    const play = serializePlayBlock(entitlements, user.id, workspace.id);
    // A Play subscriber is not paying the euro list price: Google converts the
    // base price per country. Saying so is the only honest thing this endpoint
    // can do, since the real figure exists only on the device.
    const priceSource: PriceSource = planSource === "google_play" ? "google_play" : "eur_list";

    return NextResponse.json({
      entitlements: serializeEntitlements(entitlements),
      planSource,
      priceSource,
      plans: planOrder(edition).map((id) => serializePlan(getPlan(id, edition))),
      usage: serializeUsageMeters(entitlements),
      // False means this server has no Stripe keys, so upgrading is impossible
      // and a client should say so rather than opening a checkout that 503s.
      billingConfigured: isBillingConfigured(),
      play,
      management: serializeBillingManagement(
        entitlements,
        play,
        isBillingConfigured(),
        planSource
      ),
    });
  } catch (error) {
    return apiError("GET /api/billing/summary", "Failed to load billing", error);
  }
}
