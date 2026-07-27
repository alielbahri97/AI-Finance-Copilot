import { NextResponse } from "next/server";

import { getOrCreateStripeCustomer, getStripe } from "@/lib/billing/stripe";
import { getOrCreateProfile } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";

/** Creates a Stripe Billing Portal session for managing the subscription. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Billing is not configured on this server" },
        { status: 503 }
      );
    }

    const profile = await getOrCreateProfile(user);
    const customerId = await getOrCreateStripeCustomer(stripe, user.id, profile.email);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("POST /api/billing/portal failed:", error);
    return NextResponse.json({ error: "Could not open the billing portal" }, { status: 500 });
  }
}
