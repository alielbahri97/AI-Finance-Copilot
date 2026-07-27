import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getEntitlements } from "@/lib/billing/entitlements";
import { GC_REQUISITION_COOKIE, STATE_COOKIE } from "@/lib/integrations/cookies";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { appUrl, buildAuthUrl } from "@/lib/integrations/oauth";
import { createRequisition } from "@/lib/integrations/providers/gocardless";
import { getProvider, isProviderConfigured } from "@/lib/integrations/registry";
import { getUser } from "@/lib/supabase/server";
import { logger, serializeError } from "@/lib/logger";

function backToIntegrations(error?: string): NextResponse {
  const url = new URL("/integrations", appUrl());
  if (error) url.searchParams.set("error", error.slice(0, 200));
  return NextResponse.redirect(url);
}

/**
 * Starts the connect flow for OAuth2 providers (redirect with a state nonce
 * in an httpOnly cookie) and for GoCardless requisitions. Plaid connects via
 * the link-token endpoints; Teams via the webhook endpoint.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.redirect(new URL("/login", appUrl()));
    }

    const entitlements = await getEntitlements(user.id);
    if (!entitlements.plan.limits.integrationsEnabled) {
      return backToIntegrations("Integrations require the Business plan.");
    }

    const provider = getProvider(providerId);
    if (!provider) {
      return backToIntegrations("Unknown integration provider.");
    }
    if (!isProviderConfigured(provider) || !isEncryptionConfigured()) {
      return backToIntegrations(`${provider.name} is not configured on this server.`);
    }

    if (provider.flow === "redirect" && provider.id === "gocardless") {
      const institution =
        new URL(request.url).searchParams.get("institution") ||
        process.env.GOCARDLESS_INSTITUTION_ID ||
        "SANDBOXFINANCE_SFIN0000";
      const reference = `${user.id}:${randomBytes(8).toString("hex")}`;
      const { requisitionId, link } = await createRequisition(institution, reference);
      const response = NextResponse.redirect(link);
      response.cookies.set(GC_REQUISITION_COOKIE, requisitionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 900,
        path: "/",
      });
      return response;
    }

    if (provider.flow !== "oauth2") {
      return backToIntegrations(`${provider.name} does not use this connect flow.`);
    }

    const state = `${provider.id}.${randomBytes(16).toString("hex")}`;
    const response = NextResponse.redirect(buildAuthUrl(provider, state));
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return response;
  } catch (error) {
    logger.error(`GET /api/integrations/${providerId}/connect`, { error: serializeError(error) });
    return backToIntegrations("Could not start the connection. Try again.");
  }
}
