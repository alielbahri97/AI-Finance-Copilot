import { NextResponse } from "next/server";

import { getOrCreateStripeCustomer, getStripe } from "@/lib/billing/stripe";
import { getOrCreateProfile } from "@/lib/data";
import { getAppUrl } from "@/lib/env-url";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { apiError } from "@/lib/api/response";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";

/** Creates a Stripe Billing Portal session for the workspace subscription. */
export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace("view_billing");
    if (!auth.ok) return auth.response;
    const { user, workspace, role } = auth.ctx;

    if (role !== "OWNER" && role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only workspace owners and admins can manage billing." },
        { status: 403 }
      );
    }

    const limited = await enforceRateLimit("billing", user.id);
    if (limited) return limited;

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Billing is not configured on this server" },
        { status: 503 }
      );
    }

    const profile = await getOrCreateProfile(user);
    const customerId = await getOrCreateStripeCustomer(
      stripe,
      workspace.id,
      user.id,
      profile.email
    );
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
      ? getAppUrl()
      : new URL(request.url).origin;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/billing`,
    });

    await recordAudit(workspace.id, user.id, "billing.portal_opened");

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return apiError("POST /api/billing/portal", "Could not open the billing portal", error);
  }
}
