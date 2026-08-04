import { NextResponse } from "next/server";

import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { createPlaidLinkToken } from "@/lib/integrations/providers/plaid";
import { getProvider, isProviderConfigured } from "@/lib/integrations/registry";
import { logger, serializeError } from "@/lib/logger";

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

    const linkToken = await createPlaidLinkToken(access.ctx.user.id);
    return NextResponse.json({ linkToken });
  } catch (error) {
    logger.error("POST /api/integrations/plaid/link-token", { error: serializeError(error) });
    return NextResponse.json({ error: "Could not create a Link token" }, { status: 502 });
  }
}
