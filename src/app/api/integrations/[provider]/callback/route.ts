import { NextResponse, type NextRequest } from "next/server";

import { saveConnection } from "@/lib/integrations/connections";
import { GC_REQUISITION_COOKIE, STATE_COOKIE } from "@/lib/integrations/cookies";
import { appUrl, exchangeCode } from "@/lib/integrations/oauth";
import { getProviderHooks } from "@/lib/integrations/providers";
import { finalizeRequisition } from "@/lib/integrations/providers/gocardless";
import { getProvider } from "@/lib/integrations/registry";
import { getUser } from "@/lib/supabase/server";
import { logger, serializeError } from "@/lib/logger";

function finish(error?: string, connected?: string): NextResponse {
  const url = new URL("/integrations", appUrl());
  if (error) url.searchParams.set("error", error.slice(0, 200));
  if (connected) url.searchParams.set("connected", connected);
  const response = NextResponse.redirect(url);
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(GC_REQUISITION_COOKIE);
  return response;
}

/**
 * OAuth2 callback: verifies the state cookie, exchanges the code, lets the
 * provider hook derive metadata (realmId, tenant, webhook URL...) and stores
 * the encrypted tokens. Also finalizes GoCardless requisitions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.redirect(new URL("/login", appUrl()));
    }

    const provider = getProvider(providerId);
    if (!provider) {
      return finish("Unknown integration provider.");
    }

    const query = Object.fromEntries(request.nextUrl.searchParams.entries());

    if (query.error) {
      // GoCardless sends error + details; OAuth providers error_description.
      return finish(`${provider.name}: ${query.error_description || query.details || query.error}`);
    }

    if (provider.flow === "redirect" && provider.id === "gocardless") {
      const requisitionId = request.cookies.get(GC_REQUISITION_COOKIE)?.value;
      if (!requisitionId) {
        return finish("The connection session expired. Try again.");
      }
      const finalized = await finalizeRequisition(requisitionId);
      await saveConnection(user.id, provider.id, {
        metadata: {
          requisitionId,
          accounts: finalized.accounts,
          accountLabels: finalized.accountLabels,
          institutionId: finalized.institutionId,
          institutionName: finalized.institutionName,
          consentExpiresAt: finalized.consentExpiresAt,
          maxHistoricalDays: finalized.maxHistoricalDays,
        },
      });
      return finish(undefined, provider.id);
    }

    if (provider.flow !== "oauth2") {
      return finish(`${provider.name} does not use this callback.`);
    }

    const expectedState = request.cookies.get(STATE_COOKIE)?.value;
    if (!expectedState || query.state !== expectedState || !expectedState.startsWith(`${provider.id}.`)) {
      return finish("State mismatch — the connection attempt was rejected. Try again.");
    }
    if (!query.code) {
      return finish(`${provider.name} did not return an authorization code.`);
    }

    const tokens = await exchangeCode(provider, query.code);
    const hooks = getProviderHooks(provider.id);
    const extras = hooks.afterConnect
      ? await hooks.afterConnect({ userId: user.id, tokens, query })
      : {};

    await saveConnection(user.id, provider.id, {
      accessToken: extras.accessToken !== undefined ? extras.accessToken : tokens.accessToken,
      refreshToken:
        extras.refreshToken !== undefined ? extras.refreshToken : tokens.refreshToken,
      expiresAt: extras.expiresAt !== undefined ? extras.expiresAt : tokens.expiresAt,
      metadata: extras.metadata ?? {},
    });

    return finish(undefined, provider.id);
  } catch (error) {
    logger.error(`GET /api/integrations/${providerId}/callback`, { error: serializeError(error) });
    const message = error instanceof Error ? error.message : "Connection failed.";
    return finish(message);
  }
}
