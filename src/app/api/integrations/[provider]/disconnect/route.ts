import { NextResponse } from "next/server";

import { lookupRequestedConnection } from "@/lib/integrations/connections";
import { decryptSecret } from "@/lib/integrations/crypto";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { getProviderHooks } from "@/lib/integrations/providers";
import { getProvider } from "@/lib/integrations/registry";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api/response";
import { logger, serializeError } from "@/lib/logger";
import { recordAudit } from "@/lib/workspace/audit";

/**
 * Removes ONE connection; the workspace's other connections to the same
 * provider are untouched. Token revocation is best-effort where supported.
 * Already-imported transactions stay: they are ordinary rows in the ledger,
 * and the confirm dialog says so.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;

  try {
    const access = await requireIntegrationAccess();
    if (!access.ok) return access.response;

    const provider = getProvider(providerId);
    if (!provider) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as { connectionId?: string } | null;
    const lookup = await lookupRequestedConnection(
      access.ctx.workspace.id,
      provider.id,
      body?.connectionId
    );
    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    }
    const connection = lookup.connection;

    const hooks = getProviderHooks(provider.id);
    if (hooks.revoke) {
      let token: string | null = null;
      try {
        token = connection.accessToken ? decryptSecret(connection.accessToken) : null;
      } catch {
        token = null;
      }
      await hooks
        .revoke(connection, token)
        .catch((error) =>
          logger.error(`[integrations] ${provider.id} revocation`, { error: serializeError(error) })
        );
    }

    await prisma.integrationConnection.delete({ where: { id: connection.id } });
    await recordAudit(access.ctx.workspace.id, access.ctx.user.id, "integration.disconnected", {
      provider: provider.id,
      connectionId: connection.id,
      institution: connection.institutionName ?? connection.externalId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(`POST /api/integrations/${providerId}/disconnect`, "Failed to disconnect", error);
  }
}
