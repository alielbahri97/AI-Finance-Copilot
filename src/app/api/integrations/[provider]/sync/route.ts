import { NextResponse } from "next/server";

import { getConnection } from "@/lib/integrations/connections";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { getProvider } from "@/lib/integrations/registry";
import { runSync } from "@/lib/integrations/sync";

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

    const connection = await getConnection(access.user.id, provider.id);
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
    return NextResponse.json({ ok: true, status: outcome.status, stats: outcome.stats ?? {} });
  } catch (error) {
    console.error(`POST /api/integrations/${providerId}/sync failed:`, error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
