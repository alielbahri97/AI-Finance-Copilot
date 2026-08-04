import "server-only";

import { getEntitlements } from "@/lib/billing/entitlements";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { getProviders, isProviderConfigured } from "@/lib/integrations/registry";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import type { HelpUserContext } from "./prompt";

/** Per-workspace figures; null when they cannot be read for this request. */
interface WorkspaceFacts {
  planName: string;
  integrationsEnabled: boolean;
  connectionStatuses: Record<string, string>;
  transactionCount: number;
  invoiceCount: number;
}

async function readWorkspaceFacts(workspaceId: string): Promise<WorkspaceFacts> {
  const [entitlements, connections, transactionCount, invoiceCount] = await Promise.all([
    getEntitlements(workspaceId),
    prisma.integrationConnection.findMany({
      where: { workspaceId },
      select: { provider: true, status: true },
    }),
    prisma.transaction.count({ where: { workspaceId } }),
    prisma.invoice.count({ where: { workspaceId } }),
  ]);

  return {
    planName: entitlements.plan.name,
    integrationsEnabled: entitlements.plan.limits.integrationsEnabled,
    connectionStatuses: Object.fromEntries(
      connections.map((connection) => [connection.provider, connection.status])
    ),
    transactionCount,
    invoiceCount,
  };
}

/**
 * Small situational block for the help agent: enough to tailor instructions
 * (plan gates, which integrations exist on this server, whether the user has
 * data yet) without exposing any actual financial figures.
 *
 * `workspaceId` is null when the caller has no resolvable workspace. Failures
 * here are swallowed on purpose: the help agent is the channel users reach for
 * when something else is already broken, so it degrades to a generic answer
 * rather than returning an error.
 */
export async function buildHelpUserContext(
  workspaceId: string | null
): Promise<HelpUserContext> {
  let facts: WorkspaceFacts | null = null;
  if (workspaceId) {
    try {
      facts = await readWorkspaceFacts(workspaceId);
    } catch (error) {
      logger.error("Help context lookup failed; answering without workspace facts", {
        workspaceId,
        error: serializeError(error),
      });
    }
  }

  const encryptionReady = isEncryptionConfigured();
  const configuredProviders: string[] = [];
  const unconfiguredProviders: string[] = [];
  for (const provider of getProviders()) {
    if (encryptionReady && isProviderConfigured(provider)) {
      configuredProviders.push(provider.id);
    } else {
      unconfiguredProviders.push(provider.id);
    }
  }

  return {
    planName: facts?.planName ?? "unknown",
    integrationsEnabled: facts?.integrationsEnabled ?? false,
    configuredProviders,
    unconfiguredProviders,
    connectionStatuses: facts?.connectionStatuses ?? {},
    transactionCount: facts?.transactionCount ?? 0,
    invoiceCount: facts?.invoiceCount ?? 0,
  };
}
