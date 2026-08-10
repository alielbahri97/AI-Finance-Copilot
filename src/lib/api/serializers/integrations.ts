/**
 * Wire shaping for `GET /api/integrations`.
 *
 * This is the integrations page's own mapping (`toConnectionData` and the card
 * builder), with money and dates moved onto the wire contract. The derived
 * fields are kept — `title`, `accountLabel`, `includedBalance` — because a
 * native client that recomputed them would be a second implementation of rules
 * (only sum accounts that agree on a currency; prefer the user's own label)
 * that are easy to get subtly wrong.
 */

import { money, moneyOrNull, timestampOrNull } from "@/lib/api/wire";
import type { MoneyString, TimestampString } from "@/lib/api/wire";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { isProviderConfigured, type IntegrationProvider } from "@/lib/integrations/registry";

/**
 * A connection row with the relations the client needs. Structural rather than
 * a Prisma payload type, so the page's pre-0016 fallback shape — the same rows
 * without the per-account columns that migration adds — fits too.
 */
export interface ConnectionRow {
  id: string;
  provider: string;
  status: "CONNECTED" | "ERROR" | "EXPIRED";
  displayName: string | null;
  institutionName: string | null;
  institutionLogo: string | null;
  metadata: unknown;
  lastSyncAt: Date | null;
  lastError: string | null;
  syncRuns: { stats: unknown }[];
  bankAccounts: {
    id: string;
    name: string | null;
    mask: string | null;
    currency: string | null;
    lastBalance: { toFixed(digits: number): string } | null;
    lastBalanceAt: Date | null;
    includeInTotals: boolean;
  }[];
}

export interface SerializedIntegrationAccount {
  id: string;
  /** Provider-supplied account name, when it gave one. */
  name: string | null;
  /** Masked account number, e.g. "…1234". */
  mask: string | null;
  /** What to show: mask, else name, else "Account". */
  label: string;
  currency: string | null;
  lastBalance: MoneyString | null;
  lastBalanceAt: TimestampString | null;
  includeInTotals: boolean;
}

export interface SerializedConnection {
  id: string;
  provider: string;
  status: "CONNECTED" | "ERROR" | "EXPIRED";
  displayName: string | null;
  institutionName: string | null;
  institutionLogo: string | null;
  /** Row heading: displayName, else institutionName, else the provider name. */
  title: string;
  lastSyncAt: TimestampString | null;
  lastError: string | null;
  /** Slack channel / Xero tenant / "3 accounts", when known. */
  accountLabel: string | null;
  calendarEnabled: boolean;
  /** Stats the most recent sync run recorded; counts, so plain numbers. */
  lastRunStats: Record<string, number> | null;
  /** End-user agreement expiry (GoCardless consent), when known. */
  consentExpiresAt: TimestampString | null;
  /** Latest still-future per-account throttle window, when the bank set one. */
  rateLimitedUntil: TimestampString | null;
  accounts: SerializedIntegrationAccount[];
  /** Sum of the counted accounts, only when they share one currency. */
  includedBalance: MoneyString | null;
  balanceCurrency: string | null;
}

export interface SerializedProviderCard {
  id: string;
  name: string;
  description: string;
  category: IntegrationProvider["category"];
  capabilities: IntegrationProvider["capabilities"];
  flow: IntegrationProvider["flow"];
  /** Both the provider's own env vars and the shared encryption key are set. */
  configured: boolean;
  missingEnvVars: string[];
  requiredEnvVars: string[];
  /** Whether the provider has anything to pull (vs. outgoing-only). */
  syncable: boolean;
  /** Whether a second connection to this provider is allowed. */
  multiInstance: boolean;
  connections: SerializedConnection[];
}

function metadataOf(connection: ConnectionRow): Record<string, unknown> {
  const metadata = connection.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as Record<string, unknown>;
}

/** The page's per-provider subtitle: what this connection is pointed at. */
function accountLabel(
  providerId: string,
  metadata: Record<string, unknown>,
  accountCount: number
): string | null {
  switch (providerId) {
    case "slack":
      return metadata.channel ? `Posting to ${metadata.channel}` : null;
    case "xero":
      return metadata.tenantName ? `Organisation: ${metadata.tenantName}` : null;
    case "quickbooks":
      return metadata.realmId ? `Company ${metadata.realmId}` : null;
    case "exact":
      return metadata.division ? `Division ${metadata.division}` : null;
    case "plaid":
    case "gocardless":
      return accountCount > 0 ? `${accountCount} account${accountCount > 1 ? "s" : ""}` : null;
    default:
      return null;
  }
}

/** Latest still-active per-account rate-limit window. */
function rateLimitedUntil(metadata: Record<string, unknown>, now = Date.now()): string | null {
  const map = metadata.rateLimitedUntil as Record<string, string> | undefined;
  if (!map) return null;
  const future = Object.values(map)
    .map((value) => Date.parse(value))
    .filter((time) => Number.isFinite(time) && time > now);
  if (future.length === 0) return null;
  return new Date(Math.max(...future)).toISOString();
}

function statsOf(connection: ConnectionRow): Record<string, number> | null {
  const stats = connection.syncRuns[0]?.stats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;
  return stats as Record<string, number>;
}

export function serializeConnection(
  providerName: string,
  connection: ConnectionRow
): SerializedConnection {
  const metadata = metadataOf(connection);
  const accounts = connection.bankAccounts.map((account) => ({
    id: account.id,
    name: account.name,
    mask: account.mask,
    label: account.mask || account.name || "Account",
    currency: account.currency,
    lastBalance: moneyOrNull(account.lastBalance),
    lastBalanceAt: timestampOrNull(account.lastBalanceAt),
    includeInTotals: account.includeInTotals,
  }));

  // Only total accounts that agree on a currency — there is no FX rate here.
  const counted = connection.bankAccounts.filter(
    (account) => account.includeInTotals && account.lastBalance !== null
  );
  const currencies = new Set(counted.map((account) => account.currency ?? ""));
  const sameCurrency = counted.length > 0 && currencies.size === 1;
  const includedTotal = counted.reduce(
    (sum, account) => sum + Number(account.lastBalance?.toFixed(2) ?? 0),
    0
  );

  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    displayName: connection.displayName,
    institutionName: connection.institutionName,
    institutionLogo: connection.institutionLogo,
    title: connection.displayName || connection.institutionName || providerName,
    lastSyncAt: timestampOrNull(connection.lastSyncAt),
    lastError: connection.lastError,
    accountLabel: accountLabel(connection.provider, metadata, accounts.length),
    calendarEnabled: metadata.calendarEnabled === true,
    lastRunStats: statsOf(connection),
    consentExpiresAt:
      typeof metadata.consentExpiresAt === "string"
        ? timestampOrNull(metadata.consentExpiresAt)
        : null,
    rateLimitedUntil: timestampOrNull(rateLimitedUntil(metadata)),
    accounts,
    includedBalance: sameCurrency ? money(includedTotal) : null,
    balanceCurrency: sameCurrency ? (counted[0].currency ?? null) : null,
  };
}

export function serializeProviderCard(
  provider: IntegrationProvider,
  connections: ConnectionRow[]
): SerializedProviderCard {
  const encryptionReady = isEncryptionConfigured();
  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    category: provider.category,
    capabilities: provider.capabilities,
    flow: provider.flow,
    configured: isProviderConfigured(provider) && encryptionReady,
    missingEnvVars: [
      ...(encryptionReady ? [] : ["INTEGRATION_ENCRYPTION_KEY"]),
      ...provider.envVars.filter((envVar) => !process.env[envVar]),
    ],
    requiredEnvVars: [...provider.envVars, "INTEGRATION_ENCRYPTION_KEY"],
    syncable: provider.syncIntervalHours !== null,
    multiInstance: provider.multiInstance,
    connections: connections.map((connection) => serializeConnection(provider.name, connection)),
  };
}
