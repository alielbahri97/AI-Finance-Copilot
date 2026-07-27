import { NextResponse } from "next/server";
import { z } from "zod";

import { getEntitlements } from "@/lib/billing/entitlements";
import { getPlanPriceId, TRIAL_DAYS } from "@/lib/billing/plans";
import { getOrCreateStripeCustomer, getStripe } from "@/lib/billing/stripe";
import { getOrCreateProfile } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { apiError } from "@/lib/api/response";

const checkoutSchema = z.object({
  plan: z.enum(["PRO", "BUSINESS"]),
});

/** Creates a Stripe Checkout Session for a self-serve upgrade. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await enforceRateLimit("billing", user.id);
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Billing is not configured on this server" },
        { status: 503 }
      );
    }

    const priceId = getPlanPriceId(parsed.data.plan);
    if (!priceId) {
      return NextResponse.json(
        { error: `No Stripe price configured for the ${parsed.data.plan} plan` },
        { status: 503 }
      );
    }

    const profile = await getOrCreateProfile(user);
    const entitlements = await getEntitlements(user.id);
    const customerId = await getOrCreateStripeCustomer(stripe, user.id, profile.email);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Card-backed trial only for users who still have local trial time left
      // and have never had a paid subscription.
      subscription_data:
        entitlements.isTrial && !entitlements.currentPeriodEnd
          ? { trial_period_days: TRIAL_DAYS, metadata: { userId: user.id } }
          : { metadata: { userId: user.id } },
      metadata: { userId: user.id, plan: parsed.data.plan },
      success_url: `${appUrl}/billing?checkout=success`,
      cancel_url: `${appUrl}/billing?checkout=canceled`,
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return apiError("POST /api/billing/checkout", "Could not start checkout", error);
  }
}
