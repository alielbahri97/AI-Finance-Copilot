import "server-only";

import Stripe from "stripe";

import { prisma } from "@/lib/prisma";

import { getOrCreateSubscription } from "./entitlements";

/**
 * Stripe access. Everything degrades gracefully when STRIPE_SECRET_KEY is
 * missing: `getStripe()` returns null and the billing UI shows a
 * "billing not configured" state while the app keeps working on Free/trial.
 */

let cached: Stripe | null = null;

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) {
    cached = new Stripe(key, { typescript: true });
  }
  return cached;
}

/** Returns the user's Stripe customer id, creating the customer on first use. */
export async function getOrCreateStripeCustomer(
  stripe: Stripe,
  userId: string,
  email: string
): Promise<string> {
  const subscription = await getOrCreateSubscription(userId);
  if (subscription.stripeCustomerId) return subscription.stripeCustomerId;

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });
  await prisma.subscription.update({
    where: { userId },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

/** Maps a Stripe subscription status onto our local enum. */
export function mapStripeStatus(
  status: Stripe.Subscription.Status
): "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}

/** Period end lives on subscription items in current Stripe API versions. */
export function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const end = subscription.items.data[0]?.current_period_end;
  return end ? new Date(end * 1000) : null;
}
