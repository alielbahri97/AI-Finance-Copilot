import { NextResponse } from "next/server";

import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { getConnection } from "@/lib/integrations/connections";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { getProvider } from "@/lib/integrations/registry";
import { runSync } from "@/lib/integrations/sync";
import { apiError } from "@/lib/api/response";

export const maxDuration = 120;

/** Manual "Sync now" for one connection. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;

  try {
    const access = await requireIntegrationAccess();
    if (!access.ok) return access.response;

    const limited = await enforceRateLimit("sync", access.ctx.user.id);
    if (limited) return limited;

    const provider = getProvider(providerId);
    if (!provider) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
    }
    if (provider.syncIntervalHours === null) {
      return NextResponse.json(
        { error: `${provider.name} has nothing to sync — it only sends notifications.` },
        { status: 400 }
      );
    }

    const connection = await getConnection(access.ctx.workspace.id, provider.id);
    if (!connection) {
      return NextResponse.json({ error: "Not connected" }, { status: 404 });
    }

    const outcome = await runSync(connection.id);
    if (outcome.status === "FAILED") {
      return NextResponse.json(
        { error: outcome.error ?? "Sync failed", status: outcome.status },
        { status: 502 }
      );
    }

    // Bank providers record the ImportBatch of the sync so the UI can link
    // straight to the imported transactions.
    const refreshed = await getConnection(access.ctx.workspace.id, provider.id);
    const batchId =
      (refreshed?.metadata as Record<string, unknown> | null)?.lastBatchId ?? null;

    return NextResponse.json({
      ok: true,
      status: outcome.status,
      stats: outcome.stats ?? {},
      batchId: typeof batchId === "string" ? batchId : null,
    });
  } catch (error) {
    return apiError(`POST /api/integrations/${providerId}/sync`, "Sync failed", error);
  }
}
