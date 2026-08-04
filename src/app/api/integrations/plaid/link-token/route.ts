import { NextResponse } from "next/server";

import { getEntitlements } from "@/lib/billing/entitlements";
import { bankQuotaRefusal, checkBankConnectionQuota } from "@/lib/integrations/bank-quota";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { createPlaidLinkToken } from "@/lib/integrations/providers/plaid";
import { getProvider, isProviderConfigured } from "@/lib/integrations/registry";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/** Creates a Plaid Link token for the client-side Link flow. */
export async function POST() {
  try {
    const access = await requireIntegrationAccess();
    if (!access.ok) return access.response;

    const provider = getProvider("plaid");
    if (!provider || !isProviderConfigured(provider)) {
      return NextResponse.json(
        { error: "Plaid is not configured on this server" },
        { status: 503 }
      );
    }

    // With nothing connected yet, Link can only end in a new bank, so an
    // exhausted allowance is refused before the user picks an institution.
    // Once Plaid is connected the flow may be a re-authorization, which
    // `saveConnection` allows and only refuses if it turns out to be a new one.
    const workspaceId = access.ctx.workspace.id;
    const connected = await prisma.integrationConnection.count({
      where: { workspaceId, provider: "plaid" },
    });
    if (connected === 0) {
      const entitlements = await getEntitlements(workspaceId);
      const quota = await checkBankConnectionQuota(
        workspaceId,
        entitlements.plan.limits.bankConnections
      );
      if (!quota.allowed) {
        return NextResponse.json(
          { error: bankQuotaRefusal(quota, entitlements.plan.name) },
          { status: 402 }
        );
      }
    }

    const linkToken = await createPlaidLinkToken(access.ctx.user.id);
    return NextResponse.json({ linkToken });
  } catch (error) {
    logger.error("POST /api/integrations/plaid/link-token", { error: serializeError(error) });
    return NextResponse.json({ error: "Could not create a Link token" }, { status: 502 });
  }
}
