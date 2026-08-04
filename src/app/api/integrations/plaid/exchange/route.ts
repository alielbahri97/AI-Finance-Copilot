import { NextResponse } from "next/server";
import { z } from "zod";

import { saveConnection } from "@/lib/integrations/connections";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { exchangePlaidPublicToken } from "@/lib/integrations/providers/plaid";
import { logger, serializeError } from "@/lib/logger";
import { recordAudit } from "@/lib/workspace/audit";

const exchangeSchema = z.object({
  publicToken: z.string().min(10).max(500),
  institution: z.string().max(200).optional(),
});

/** Exchanges the public token from Plaid Link for a permanent access token. */
export async function POST(request: Request) {
  try {
    const access = await requireIntegrationAccess();
    if (!access.ok) return access.response;

    const body = await request.json().catch(() => null);
    const parsed = exchangeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { accessToken, itemId } = await exchangePlaidPublicToken(parsed.data.publicToken);
    // One Plaid Item per bank: the item id keys the connection, so linking a
    // second bank adds one instead of replacing the first.
    const connection = await saveConnection(
      { workspaceId: access.ctx.workspace.id, userId: access.ctx.user.id },
      "plaid",
      {
        accessToken,
        externalId: itemId,
        institutionName: parsed.data.institution ?? null,
        metadata: { itemId, institution: parsed.data.institution ?? null },
      }
    );
    await recordAudit(access.ctx.workspace.id, access.ctx.user.id, "integration.connected", {
      provider: "plaid",
      connectionId: connection.id,
    });

    return NextResponse.json({ ok: true, connectionId: connection.id });
  } catch (error) {
    logger.error("POST /api/integrations/plaid/exchange", { error: serializeError(error) });
    return NextResponse.json({ error: "Could not complete the connection" }, { status: 502 });
  }
}
