import { NextResponse } from "next/server";
import { z } from "zod";

import type { IntegrationConnection } from "@/generated/prisma/client";
import { apiError } from "@/lib/api/response";
import { moneyOrNull, timestampOrNull } from "@/lib/api/wire";
import { recordBankAccounts } from "@/lib/integrations/bank-accounts";
import { saveConnection } from "@/lib/integrations/connections";
import { IntegrationError } from "@/lib/integrations/oauth";
import {
  findPendingByReference,
  markPendingCompleted,
  markPendingFailed,
  pendingBelongsTo,
  pendingConnectionRefusal,
} from "@/lib/integrations/pending-connections";
import { finalizeRequisition } from "@/lib/integrations/providers/gocardless";
import { getProvider } from "@/lib/integrations/registry";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";

/**
 * Finishes a bank connection a client started at /link. The web flow reaches
 * the same code through the bank's redirect to [provider]/callback; a native
 * client has no redirect to catch, so it posts back the reference it was given
 * once the Custom Tab closes.
 */

const PROVIDER_ID = "gocardless";

const bodySchema = z.object({
  reference: z.string({ error: "reference is required" }).min(1, "reference is required").max(200),
});

async function connectionPayload(connection: IntegrationConnection) {
  const accounts = await prisma.bankAccount.findMany({
    where: { connectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    institutionName: connection.institutionName,
    institutionLogo: connection.institutionLogo,
    accounts: accounts.map((account) => ({
      id: account.id,
      externalAccountId: account.externalAccountId,
      name: account.name,
      mask: account.mask,
      currency: account.currency,
      includeInTotals: account.includeInTotals,
      // Balances arrive with the first sync, so they are usually null here.
      balance: moneyOrNull(account.lastBalance),
      balanceAt: timestampOrNull(account.lastBalanceAt),
    })),
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request, "manage_integrations");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const provider = getProvider(PROVIDER_ID);
    if (!provider) {
      return NextResponse.json({ error: "Unknown integration provider." }, { status: 404 });
    }

    const scope = { workspaceId: workspace.id, userId: user.id };
    const pending = await findPendingByReference(parsed.data.reference);
    // THE security check of this endpoint. A reference is a bearer credential
    // for one attempt, so a row belonging to another user — or to the same user
    // in another workspace — is reported exactly as an unknown one: saying
    // "that is not yours" would confirm the reference exists.
    if (!pending || pending.provider !== provider.id || !pendingBelongsTo(pending, scope)) {
      return NextResponse.json(
        { error: "No pending bank connection matches that reference.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    // Idempotent: a client that lost the response to a retry, or resumed after
    // the Custom Tab was dismissed, must get the connection it already made
    // rather than a second one.
    if (pending.status === "COMPLETED" && pending.connectionId) {
      const existing = await prisma.integrationConnection.findFirst({
        where: { id: pending.connectionId, workspaceId: workspace.id },
      });
      if (!existing) {
        return NextResponse.json(
          { error: "That bank connection has since been disconnected. Connect again." },
          { status: 410 }
        );
      }
      return NextResponse.json({ connection: await connectionPayload(existing) });
    }

    const refusal = pendingConnectionRefusal(pending);
    if (refusal) {
      return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    }

    try {
      const finalized = await finalizeRequisition(pending.requisitionId);
      // Keyed by institution, not by requisition: renewing consent mints a new
      // requisition for the same bank and must update that bank's connection
      // instead of adding a duplicate.
      const connection = await saveConnection(scope, provider.id, {
        externalId: finalized.institutionId,
        institutionName: finalized.institutionName,
        institutionLogo: finalized.institutionLogo,
        metadata: {
          requisitionId: pending.requisitionId,
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
      await recordAudit(workspace.id, user.id, "integration.connected", {
        provider: provider.id,
        connectionId: connection.id,
        institution: finalized.institutionName ?? finalized.institutionId,
      });

      const payload = await connectionPayload(connection);
      await markPendingCompleted(pending.id, connection.id);
      return NextResponse.json({ connection: payload });
    } catch (error) {
      const message =
        error instanceof IntegrationError
          ? error.message
          : "Could not complete the bank connection.";
      await markPendingFailed(pending.id, message);
      if (error instanceof IntegrationError) {
        // An approval that was never finished, a consent the bank refused, a
        // spent plan allowance, a GoCardless outage: all of them fail at the
        // far end of the flow and all of them carry a message for the user.
        return NextResponse.json({ error: message }, { status: 502 });
      }
      throw error;
    }
  } catch (error) {
    return apiError(
      "POST /api/integrations/gocardless/finalize",
      "Could not complete the bank connection",
      error
    );
  }
}
