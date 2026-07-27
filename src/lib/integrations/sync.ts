import "server-only";

import { prisma } from "@/lib/prisma";

import { getFreshAccessToken, patchMetadata } from "./connections";
import { isEncryptionConfigured } from "./crypto";
import { IntegrationAuthError } from "./oauth";
import { getProviderHooks } from "./providers";
import type { SyncStats } from "./providers/types";
import { getProvider, isProviderConfigured } from "./registry";

/**
 * The sync orchestrator: runs one provider sync with SyncRun bookkeeping,
 * token refresh, and status transitions. The cron entrypoint isolates
 * per-connection failures and applies exponential backoff.
 */

export interface SyncOutcome {
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  stats?: SyncStats;
  error?: string;
}

const MAX_BACKOFF_EXPONENT = 4; // interval * 2^4 max

export async function runSync(connectionId: string): Promise<SyncOutcome> {
  const connection = await prisma.integrationConnection.findUnique({
    where: { id: connectionId },
    include: { profile: { select: { currency: true, aiProvider: true } } },
  });
  if (!connection) {
    return { status: "SKIPPED", error: "Connection not found" };
  }

  const provider = getProvider(connection.provider);
  const hooks = provider ? getProviderHooks(provider.id) : {};
  if (!provider || !hooks.sync) {
    return { status: "SKIPPED", error: "Nothing to sync for this provider" };
  }
  if (!isProviderConfigured(provider) || !isEncryptionConfigured()) {
    return { status: "SKIPPED", error: `${provider.name} is not configured on this server` };
  }

  const run = await prisma.syncRun.create({
    data: { connectionId: connection.id },
    select: { id: true },
  });

  try {
    const accessToken = connection.accessToken
      ? await getFreshAccessToken(connection)
      : null;

    const stats = await hooks.sync({
      connection,
      userId: connection.userId,
      currency: connection.profile.currency,
      aiProvider: connection.profile.aiProvider,
      accessToken,
      metadata: (connection.metadata as Record<string, unknown> | null) ?? {},
      patchMetadata: (patch) => patchMetadata(connection.id, patch),
    });

    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: run.id },
        data: { status: "SUCCESS", finishedAt: new Date(), stats },
      }),
      prisma.integrationConnection.update({
        where: { id: connection.id },
        data: {
          status: "CONNECTED",
          lastSyncAt: new Date(),
          lastError: null,
          consecutiveFailures: 0,
        },
      }),
    ]);
    return { status: "SUCCESS", stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    const expired = error instanceof IntegrationAuthError;
    console.error(`[integrations] ${connection.provider} sync failed:`, error);

    await prisma
      .$transaction([
        prisma.syncRun.update({
          where: { id: run.id },
          data: { status: "FAILED", finishedAt: new Date(), error: message.slice(0, 500) },
        }),
        prisma.integrationConnection.update({
          where: { id: connection.id },
          data: {
            status: expired ? "EXPIRED" : "ERROR",
            lastError: message.slice(0, 500),
            consecutiveFailures: { increment: 1 },
          },
        }),
      ])
      .catch((persistError) =>
        console.error("[integrations] failed to record sync failure:", persistError)
      );
    return { status: "FAILED", error: message };
  }
}

/**
 * Runs all due syncs. A connection is due when its provider interval —
 * doubled per consecutive failure (capped at 16x) — has elapsed since the
 * last attempt. EXPIRED connections are skipped: they need a reconnect.
 */
export async function runDueSyncs(): Promise<{
  checked: number;
  ran: number;
  failed: number;
}> {
  if (!isEncryptionConfigured()) {
    return { checked: 0, ran: 0, failed: 0 };
  }

  const connections = await prisma.integrationConnection.findMany({
    where: { status: { in: ["CONNECTED", "ERROR"] } },
    select: {
      id: true,
      provider: true,
      lastSyncAt: true,
      consecutiveFailures: true,
      updatedAt: true,
    },
  });

  let ran = 0;
  let failed = 0;
  const now = Date.now();

  for (const connection of connections) {
    const provider = getProvider(connection.provider);
    if (!provider?.syncIntervalHours || !isProviderConfigured(provider)) continue;

    const backoff = 2 ** Math.min(connection.consecutiveFailures, MAX_BACKOFF_EXPONENT);
    const intervalMs = provider.syncIntervalHours * backoff * 60 * 60 * 1000;
    const anchor = connection.lastSyncAt ?? connection.updatedAt;
    if (connection.lastSyncAt && now - anchor.getTime() < intervalMs) continue;
    // Never-synced connections also respect backoff from the last attempt.
    if (!connection.lastSyncAt && connection.consecutiveFailures > 0) {
      if (now - connection.updatedAt.getTime() < intervalMs) continue;
    }

    ran += 1;
    try {
      const outcome = await runSync(connection.id);
      if (outcome.status === "FAILED") failed += 1;
    } catch (error) {
      // runSync already isolates errors; this is a belt-and-braces guard.
      failed += 1;
      console.error("[integrations] sync crashed:", error);
    }
  }

  return { checked: connections.length, ran, failed };
}
