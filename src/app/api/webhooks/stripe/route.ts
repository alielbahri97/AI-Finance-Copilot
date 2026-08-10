import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { trackEvent } from "@/lib/analytics";
import { refreshResolvedSubscription } from "@/lib/billing/play/sync";
import { planFromPriceId } from "@/lib/billing/plans";
import { convertReferral } from "@/lib/billing/referrals";
import { getStripe, mapStripeStatus, subscriptionPeriodEnd } from "@/lib/billing/stripe";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api/response";
import { logger, serializeError } from "@/lib/logger";
import { recordAudit } from "@/lib/workspace/audit";
import { personalWorkspaceId } from "@/lib/workspace/ids";

export const maxDuration = 60;

/**
 * Stripe webhook: keeps the local Subscription row in sync. Configure the
 * endpoint in the Stripe dashboard with the events listed below and put the
 * signing secret in STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const payload = await request.text();
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch (error) {
    logger.error("[billing] webhook signature verification", { error: serializeError(error) });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.userId ?? null;
        const workspaceId =
          session.metadata?.workspaceId ?? (userId ? personalWorkspaceId(userId) : null);
        if (workspaceId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id
          );
          await syncSubscription(subscription, workspaceId);
          await recordAudit(workspaceId, userId, "billing.plan_changed", {
            plan: session.metadata?.plan ?? null,
            source: "checkout",
          });
          if (userId) {
            await convertReferral(userId);
            await trackEvent(userId, "upgrade", {
              plan: session.metadata?.plan ?? null,
              source: "checkout",
            });
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        await syncSubscription(event.data.object);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        // Read the workspaces first: once the Stripe id is cleared there is no
        // way back to them, and each one has to be re-resolved afterwards in
        // case Google Play is still paying for it.
        const affected = await prisma.subscription.findMany({
          where: { stripeSubscriptionId: subscription.id },
          select: { workspaceId: true },
        });
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            plan: "FREE",
            status: "CANCELED",
            stripeSubscriptionId: null,
            stripePriceId: null,
            stripePlan: null,
            stripeStatus: "CANCELED",
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
          },
        });
        for (const row of affected) {
          await refreshResolvedSubscription(row.workspaceId);
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
        if (customerId) {
          await prisma.subscription.updateMany({
            where: { stripeCustomerId: customerId, status: "PAST_DUE" },
            data: { status: "ACTIVE", stripeStatus: "ACTIVE" },
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
        if (customerId) {
          await prisma.subscription.updateMany({
            where: { stripeCustomerId: customerId, stripeSubscriptionId: { not: null } },
            data: { status: "PAST_DUE", stripeStatus: "PAST_DUE" },
          });
        }
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    return apiError(`[billing] webhook handling failed for ${event.type}`, "Webhook handling failed", error);
  }
}

/** Writes a Stripe subscription's plan/status/period onto the local row. */
async function syncSubscription(
  subscription: Stripe.Subscription,
  knownWorkspaceId?: string
): Promise<void> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const priceId = subscription.items.data[0]?.price.id ?? null;
  // The price id identifies both the tier and the edition that sells it; only
  // the tier is stored, because the workspace already knows its edition.
  const matched = (priceId && planFromPriceId(priceId)) || null;

  const status = mapStripeStatus(subscription.status);
  const data = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    // Stripe's own tier and status, which resolution reads, and the resolved
    // cache, which it overwrites a moment later. Both are written here so that
    // a workspace with no Play purchase behaves exactly as it always did even
    // if the re-resolution below fails.
    stripeStatus: status,
    status,
    currentPeriodEnd: subscriptionPeriodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    ...(matched ? { plan: matched.planId, stripePlan: matched.planId, planSource: "STRIPE" as const } : {}),
  };

  // Metadata: new checkouts carry workspaceId; pre-workspace subscriptions
  // carried userId, which maps onto the user's personal workspace.
  const metadataUserId = subscription.metadata?.userId;
  const workspaceId =
    knownWorkspaceId ??
    subscription.metadata?.workspaceId ??
    (metadataUserId ? personalWorkspaceId(metadataUserId) : undefined);
  if (workspaceId) {
    await prisma.subscription.upsert({
      where: { workspaceId },
      update: data,
      create: { workspaceId, ...data },
    });
    // Re-resolve, because Stripe is no longer the only payer: a complimentary
    // grant or a higher-tier Play subscription still wins, and writing Stripe's
    // tier over the top of either would be a silent downgrade.
    await refreshResolvedSubscription(workspaceId);
    return;
  }

  // Fall back to matching by Stripe ids when metadata is missing.
  const matchedRows = await prisma.subscription.findMany({
    where: { OR: [{ stripeSubscriptionId: subscription.id }, { stripeCustomerId: customerId }] },
    select: { workspaceId: true },
  });
  const updated = await prisma.subscription.updateMany({
    where: { OR: [{ stripeSubscriptionId: subscription.id }, { stripeCustomerId: customerId }] },
    data,
  });
  if (updated.count === 0) {
    logger.warn("stripe webhook could not match subscription to a local workspace", {
      stripeSubscriptionId: subscription.id,
    });
    return;
  }
  for (const row of matchedRows) {
    await refreshResolvedSubscription(row.workspaceId);
  }
}
