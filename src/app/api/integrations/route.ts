import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import {
  serializeProviderCard,
  type ConnectionRow,
} from "@/lib/api/serializers/integrations";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isSchemaOutOfDate } from "@/lib/db-errors";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { providersForWorkspace } from "@/lib/integrations/registry";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

/**
 * Every connection in the workspace. Falls back to the pre-0016 column set when
 * the deploy is ahead of the migration, so the list still answers (without
 * per-account balances) instead of 500ing — the same degradation the web page
 * does, for the same reason.
 */
async function loadConnections(workspaceId: string): Promise<ConnectionRow[]> {
  const syncRuns = { orderBy: { startedAt: "desc" }, take: 1, select: { stats: true } } as const;
  try {
    return await prisma.integrationConnection.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      include: { syncRuns, bankAccounts: { orderBy: { createdAt: "asc" } } },
    });
  } catch (error) {
    if (!isSchemaOutOfDate(error)) throw error;
    logger.warn("[integrations] multi-connection columns unavailable; degrading", {
      error: serializeError(error),
    });
    const rows = await prisma.integrationConnection.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        provider: true,
        status: true,
        metadata: true,
        lastSyncAt: true,
        lastError: true,
        syncRuns,
      },
    });
    return rows.map((row) => ({
      ...row,
      displayName: null,
      institutionName: null,
      institutionLogo: null,
      bankAccounts: [],
    }));
  }
}

/**
 * The provider grid and everything connected to it.
 *
 * `locked` reports that the plan does not include integrations, and is not a
 * 402: the web page still renders the whole grid behind an upgrade banner,
 * because seeing what you would get is the point of showing it. The connect and
 * sync routes are where the plan is actually enforced.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request, "manage_integrations");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const [entitlements, connections] = await Promise.all([
      getEntitlements(workspace.id),
      loadConnections(workspace.id),
    ]);

    const byProvider = new Map<string, ConnectionRow[]>();
    for (const connection of connections) {
      byProvider.set(connection.provider, [
        ...(byProvider.get(connection.provider) ?? []),
        connection,
      ]);
    }

    // Accounting systems and mailbox scanning only make sense where invoices
    // do, so a Personal workspace never sees those providers at all.
    const providers = providersForWorkspace(workspace.type).map((provider) =>
      serializeProviderCard(provider, byProvider.get(provider.id) ?? [])
    );

    return NextResponse.json({
      locked: !entitlements.plan.limits.integrationsEnabled,
      // False means no provider can be connected until the key is set.
      encryptionConfigured: isEncryptionConfigured(),
      bankConnectionLimit: entitlements.plan.limits.bankConnections,
      currency: workspace.currency,
      providers,
    });
  } catch (error) {
    return apiError("GET /api/integrations", "Failed to load integrations", error);
  }
}
