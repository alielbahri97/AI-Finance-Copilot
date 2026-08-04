import { NextResponse } from "next/server";

import { getConnection } from "@/lib/integrations/connections";
import { decryptSecret } from "@/lib/integrations/crypto";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { getProviderHooks } from "@/lib/integrations/providers";
import { getProvider } from "@/lib/integrations/registry";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api/response";
import { logger, serializeError } from "@/lib/logger";
import { recordAudit } from "@/lib/workspace/audit";

/** Removes a connection; token revocation is best-effort where supported. */
export async function POST(
  _request: Request,
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

    const connection = await getConnection(access.ctx.workspace.id, provider.id);
    if (!connection) {
      return NextResponse.json({ error: "Not connected" }, { status: 404 });
    }

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
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(`POST /api/integrations/${providerId}/disconnect`, "Failed to disconnect", error);
  }
}
