import "server-only";

import { getEntitlements } from "@/lib/billing/entitlements";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { getProviders, isProviderConfigured } from "@/lib/integrations/registry";
import { prisma } from "@/lib/prisma";

import type { HelpUserContext } from "./prompt";

/**
 * Small situational block for the help agent: enough to tailor instructions
 * (plan gates, which integrations exist on this server, whether the user has
 * data yet) without exposing any actual financial figures.
 */
export async function buildHelpUserContext(userId: string): Promise<HelpUserContext> {
  const [entitlements, connections, transactionCount, invoiceCount] = await Promise.all([
    getEntitlements(userId),
    prisma.integrationConnection.findMany({
      where: { userId },
      select: { provider: true, status: true },
    }),
    prisma.transaction.count({ where: { userId } }),
    prisma.invoice.count({ where: { userId } }),
  ]);

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
    planName: entitlements.plan.name,
    integrationsEnabled: entitlements.plan.limits.integrationsEnabled,
    configuredProviders,
    unconfiguredProviders,
    connectionStatuses: Object.fromEntries(
      connections.map((connection) => [connection.provider, connection.status])
    ),
    transactionCount,
    invoiceCount,
  };
}
