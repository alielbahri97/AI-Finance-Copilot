import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getEntitlements } from "@/lib/billing/entitlements";
import { bankQuotaRefusal, checkBankConnectionQuota } from "@/lib/integrations/bank-quota";
import { GC_REQUISITION_COOKIE, STATE_COOKIE } from "@/lib/integrations/cookies";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { canAddConnection, multiInstanceRefusal } from "@/lib/integrations/identity";
import { appUrl, buildAuthUrl } from "@/lib/integrations/oauth";
import { createRequisition } from "@/lib/integrations/providers/gocardless";
import {
  editionAllowsProvider,
  getProvider,
  isProviderConfigured,
} from "@/lib/integrations/registry";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace/context";

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
    const ctx = await getWorkspaceContext();
    if (!ctx) {
      return NextResponse.redirect(new URL("/login", appUrl()));
    }
    if (!ctx.permissions.has("manage_integrations")) {
      return backToIntegrations("You don't have permission to manage integrations here.");
    }
    const user = ctx.user;

    const entitlements = await getEntitlements(ctx.workspace.id);
    if (!entitlements.plan.limits.integrationsEnabled) {
      return backToIntegrations("Integrations require the Business plan.");
    }

    const provider = getProvider(providerId);
    if (!provider) {
      return backToIntegrations("Unknown integration provider.");
    }
    if (!editionAllowsProvider(ctx.workspace.type, provider)) {
      return backToIntegrations(`${provider.name} is not available in this workspace.`);
    }
    if (!isProviderConfigured(provider) || !isEncryptionConfigured()) {
      return backToIntegrations(`${provider.name} is not configured on this server.`);
    }

    // "Connect another" is only offered for providers where a second
    // connection is a second source of data; refuse it early and clearly.
    const requestUrl = new URL(request.url);
    if (requestUrl.searchParams.get("intent") === "add") {
      const existing = await prisma.integrationConnection.count({
        where: { workspaceId: ctx.workspace.id, provider: provider.id },
      });
      if (!canAddConnection(provider.multiInstance, existing)) {
        return backToIntegrations(multiInstanceRefusal(provider.name));
      }
      // Adding a bank is the one flow the plan can cap, and the bank's own
      // consent screen is a terrible place to learn that, so it is refused
      // before the redirect as well as at save time.
      if (provider.category === "banking") {
        const quota = await checkBankConnectionQuota(
          ctx.workspace.id,
          entitlements.plan.limits.bankConnections
        );
        if (!quota.allowed) {
          return backToIntegrations(bankQuotaRefusal(quota, entitlements.plan.name));
        }
      }
    }

    if (provider.flow === "redirect" && provider.id === "gocardless") {
      const institution =
        requestUrl.searchParams.get("institution") || process.env.GOCARDLESS_INSTITUTION_ID;
      if (!institution) {
        return backToIntegrations("Pick a bank first, then connect.");
      }
      const reference = `${user.id}:${randomBytes(8).toString("hex")}`;
      const { requisitionId, link } = await createRequisition(institution, reference);
      const response = NextResponse.redirect(link);
      // The cookie carries both halves of the pending connection: the
      // requisition to finalize and the reference GoCardless echoes back as
      // `ref`, which is what ties the callback to this attempt rather than to
      // another bank the user started connecting in a different tab.
      response.cookies.set(GC_REQUISITION_COOKIE, `${requisitionId}.${reference}`, {
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
