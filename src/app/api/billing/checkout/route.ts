import { NextResponse } from "next/server";
import { z } from "zod";

import { getEntitlements } from "@/lib/billing/entitlements";
import { getPlanPriceId, TRIAL_DAYS } from "@/lib/billing/plans";
import { getOrCreateStripeCustomer, getStripe } from "@/lib/billing/stripe";
import { getOrCreateProfile } from "@/lib/data";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { apiError } from "@/lib/api/response";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";

const checkoutSchema = z.object({
  plan: z.enum(["PRO", "BUSINESS"]),
});

/** Creates a Stripe Checkout Session for a self-serve workspace upgrade. */
export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace("view_billing");
    if (!auth.ok) return auth.response;
    const { user, workspace, role } = auth.ctx;

    // Plan changes are owner/admin actions even when billing is visible.
    if (role !== "OWNER" && role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only workspace owners and admins can change the plan." },
        { status: 403 }
      );
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
    const entitlements = await getEntitlements(workspace.id);
    const customerId = await getOrCreateStripeCustomer(
      stripe,
      workspace.id,
      user.id,
      profile.email
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const metadata = { workspaceId: workspace.id, userId: user.id };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Card-backed trial only for workspaces that still have local trial time
      // left and have never had a paid subscription.
      subscription_data:
        entitlements.isTrial && !entitlements.currentPeriodEnd
          ? { trial_period_days: TRIAL_DAYS, metadata }
          : { metadata },
      metadata: { ...metadata, plan: parsed.data.plan },
      success_url: `${appUrl}/billing?checkout=success`,
      cancel_url: `${appUrl}/billing?checkout=canceled`,
      allow_promotion_codes: true,
    });

    await recordAudit(workspace.id, user.id, "billing.checkout_started", {
      plan: parsed.data.plan,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return apiError("POST /api/billing/checkout", "Could not start checkout", error);
  }
}
