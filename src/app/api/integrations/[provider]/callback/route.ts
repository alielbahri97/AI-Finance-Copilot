import { NextResponse, type NextRequest } from "next/server";

import { recordBankAccounts } from "@/lib/integrations/bank-accounts";
import { saveConnection } from "@/lib/integrations/connections";
import { GC_REQUISITION_COOKIE, STATE_COOKIE } from "@/lib/integrations/cookies";
import { appUrl, exchangeCode } from "@/lib/integrations/oauth";
import { getProviderHooks } from "@/lib/integrations/providers";
import { finalizeRequisition } from "@/lib/integrations/providers/gocardless";
import { getProvider } from "@/lib/integrations/registry";
import { logger, serializeError } from "@/lib/logger";
import { recordAudit } from "@/lib/workspace/audit";
import { getWorkspaceContext } from "@/lib/workspace/context";

function finish(error?: string, connected?: string, connectionId?: string): NextResponse {
  const url = new URL("/integrations", appUrl());
  if (error) url.searchParams.set("error", error.slice(0, 200));
  if (connected) url.searchParams.set("connected", connected);
  // The first-sync banner needs to know which connection was just made, not
  // merely which provider — the workspace may have several.
  if (connectionId) url.searchParams.set("connection", connectionId);
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
    const ctx = await getWorkspaceContext();
    if (!ctx) {
      return NextResponse.redirect(new URL("/login", appUrl()));
    }
    if (!ctx.permissions.has("manage_integrations")) {
      return finish("You don't have permission to manage integrations in this workspace.");
    }
    const user = ctx.user;
    const scope = { workspaceId: ctx.workspace.id, userId: user.id };

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
      const pending = request.cookies.get(GC_REQUISITION_COOKIE)?.value;
      if (!pending) {
        return finish("The connection session expired. Try again.");
      }
      // "<requisitionId>.<reference>" — split on the first separator only, so a
      // reference that ever contains a dot cannot truncate into a mismatch.
      const separator = pending.indexOf(".");
      const requisitionId = separator === -1 ? pending : pending.slice(0, separator);
      const reference = separator === -1 ? "" : pending.slice(separator + 1);
      if (!requisitionId) {
        return finish("The connection session expired. Try again.");
      }
      // GoCardless echoes the reference we sent as `ref`. When it is present it
      // must match this attempt, otherwise we would attach one bank's accounts
      // to another bank's connection.
      if (query.ref && reference && query.ref !== reference) {
        return finish("That bank approval belongs to a different connection attempt. Try again.");
      }

      const finalized = await finalizeRequisition(requisitionId);
      // Keyed by institution, not by requisition: renewing consent mints a new
      // requisition for the same bank and must update that bank's connection
      // instead of adding a duplicate.
      const connection = await saveConnection(scope, provider.id, {
        externalId: finalized.institutionId,
        institutionName: finalized.institutionName,
        institutionLogo: finalized.institutionLogo,
        metadata: {
          requisitionId,
          accounts: finalized.accounts,
          institutionId: finalized.institutionId,
          institutionName: finalized.institutionName,
          consentExpiresAt: finalized.consentExpiresAt,
          maxHistoricalDays: finalized.maxHistoricalDays,
        },
      });
      await recordBankAccounts(
        connection.id,
        // No currency here: account metadata does not carry one, and passing
        // null would wipe what an earlier balance snapshot learned.
        finalized.accountDetails.map((account) => ({
          externalAccountId: account.id,
          name: account.name,
          mask: account.mask,
        }))
      );
      await recordAudit(ctx.workspace.id, user.id, "integration.connected", {
        provider: provider.id,
        connectionId: connection.id,
        institution: finalized.institutionName ?? finalized.institutionId,
      });
      return finish(undefined, provider.id, connection.id);
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

    const connection = await saveConnection(scope, provider.id, {
      accessToken: extras.accessToken !== undefined ? extras.accessToken : tokens.accessToken,
      refreshToken:
        extras.refreshToken !== undefined ? extras.refreshToken : tokens.refreshToken,
      expiresAt: extras.expiresAt !== undefined ? extras.expiresAt : tokens.expiresAt,
      metadata: extras.metadata ?? {},
      externalId: extras.externalId ?? null,
      institutionName: extras.institutionName,
    });

    await recordAudit(ctx.workspace.id, user.id, "integration.connected", {
      provider: provider.id,
      connectionId: connection.id,
    });

    return finish(undefined, provider.id, connection.id);
  } catch (error) {
    logger.error(`GET /api/integrations/${providerId}/callback`, { error: serializeError(error) });
    const message = error instanceof Error ? error.message : "Connection failed.";
    return finish(message);
  }
}
