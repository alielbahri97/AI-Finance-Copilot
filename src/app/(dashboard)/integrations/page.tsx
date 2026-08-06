import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2Icon, LockIcon, TriangleAlertIcon } from "lucide-react";

import type { Prisma } from "@/generated/prisma/client";
import { Skeleton } from "@/components/ui/skeleton";
import { FirstSyncBanner } from "@/components/integrations/first-sync-banner";
import { IntegrationsGrid } from "@/components/integrations/integrations-grid";
import type { ConnectionData, IntegrationCardData } from "@/components/integrations/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page-heading";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isSchemaOutOfDate } from "@/lib/db-errors";
import { logger, serializeError } from "@/lib/logger";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { isProviderConfigured, providersForWorkspace } from "@/lib/integrations/registry";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";
import { BanksExportButton } from "@/components/exports/surface-export-buttons";

export const metadata: Metadata = {
  title: "Integrations",
};

/**
 * A connection row with the relations the cards need. Structural rather than a
 * Prisma payload type so the pre-0016 fallback below can supply the same shape
 * without the columns that migration adds.
 */
interface ConnectionRow {
  id: string;
  provider: string;
  status: "CONNECTED" | "ERROR" | "EXPIRED";
  displayName: string | null;
  institutionName: string | null;
  institutionLogo: string | null;
  metadata: Prisma.JsonValue | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  syncRuns: { stats: Prisma.JsonValue | null }[];
  bankAccounts: {
    id: string;
    name: string | null;
    mask: string | null;
    currency: string | null;
    lastBalance: Prisma.Decimal | null;
    lastBalanceAt: Date | null;
    includeInTotals: boolean;
  }[];
}

/** Default bank-picker country from the profile currency (GoCardless covers EEA + UK). */
const CURRENCY_TO_COUNTRY: Record<string, string> = {
  GBP: "GB",
  EUR: "NL",
  SEK: "SE",
  NOK: "NO",
  DKK: "DK",
  PLN: "PL",
  CZK: "CZ",
  HUF: "HU",
  RON: "RO",
  BGN: "BG",
  ISK: "IS",
};

function accountLabel(
  provider: string,
  metadata: Record<string, unknown>,
  accountCount: number
): string | null {
  switch (provider) {
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
      return accountCount > 0
        ? `${accountCount} account${accountCount > 1 ? "s" : ""}`
        : null;
    default:
      return null;
  }
}

/** Latest still-active per-account rate-limit window, for the detail view. */
function rateLimitedUntil(metadata: Record<string, unknown>): string | null {
  const map = metadata.rateLimitedUntil as Record<string, string> | undefined;
  if (!map) return null;
  const future = Object.values(map)
    .map((value) => Date.parse(value))
    .filter((time) => Number.isFinite(time) && time > Date.now());
  if (future.length === 0) return null;
  return new Date(Math.max(...future)).toISOString();
}

/** Row shape the connection list in the detail sheet renders from. */
function toConnectionData(
  providerId: string,
  providerName: string,
  connection: ConnectionRow
): ConnectionData {
  const metadata = (connection.metadata as Record<string, unknown> | null) ?? {};
  const accounts = connection.bankAccounts.map((account) => ({
    id: account.id,
    label: account.mask || account.name || "Account",
    currency: account.currency,
    balance: account.lastBalance === null ? null : Number(account.lastBalance),
    balanceAt: account.lastBalanceAt?.toISOString() ?? null,
    includeInTotals: account.includeInTotals,
  }));

  // Only total accounts that agree on a currency — there is no FX rate here.
  const counted = accounts.filter(
    (account) => account.includeInTotals && account.balance !== null
  );
  const currencies = new Set(counted.map((account) => account.currency ?? ""));
  const sameCurrency = counted.length > 0 && currencies.size === 1;

  return {
    id: connection.id,
    status: connection.status,
    displayName: connection.displayName,
    institutionName: connection.institutionName,
    institutionLogo: connection.institutionLogo,
    title: connection.displayName || connection.institutionName || providerName,
    lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
    lastError: connection.lastError,
    accountLabel: accountLabel(providerId, metadata, accounts.length),
    calendarEnabled: metadata.calendarEnabled === true,
    lastRunStats: (connection.syncRuns[0]?.stats as Record<string, number> | null) ?? null,
    consentExpiresAt:
      typeof metadata.consentExpiresAt === "string" ? metadata.consentExpiresAt : null,
    rateLimitedUntil: rateLimitedUntil(metadata),
    accounts,
    includedBalance: sameCurrency
      ? Math.round(counted.reduce((sum, account) => sum + (account.balance ?? 0), 0) * 100) / 100
      : null,
    balanceCurrency: sameCurrency ? (counted[0].currency ?? null) : null,
  };
}

/**
 * Every connection in the workspace. Falls back to the pre-0016 column set if
 * the deploy is ahead of the migration, so the page still lists connections
 * (without per-account balances) instead of erroring.
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

type IntegrationsParams = { connected?: string; connection?: string; error?: string };

function IntegrationsGridSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 2 }).map((_, group) => (
        <div key={group} className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, tile) => (
              <Skeleton key={tile} className="h-28 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Streams: the header paints immediately; the grid + status banners follow. */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<IntegrationsParams>;
}) {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("manage_integrations")) redirect("/dashboard");

  const params = await searchParams;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageHeading>Integrations</PageHeading>
          <p className="text-muted-foreground text-sm">
            Pick a tool to see what it does and how to connect it. Connected sources sync
            automatically every few hours.
          </p>
        </div>
        {ctx.permissions.has("export_data") && <BanksExportButton />}
      </div>

      <Suspense fallback={<IntegrationsGridSkeleton />}>
        <IntegrationsContent ctx={ctx} params={params} />
      </Suspense>
    </div>
  );
}

async function IntegrationsContent({
  ctx,
  params,
}: {
  ctx: WorkspaceContext;
  params: IntegrationsParams;
}) {
  const encryptionReady = isEncryptionConfigured();
  const [entitlements, connections] = await Promise.all([
    getEntitlements(ctx.workspace.id),
    loadConnections(ctx.workspace.id),
  ]);
  const locked = !entitlements.plan.limits.integrationsEnabled;
  const byProvider = new Map<string, ConnectionRow[]>();
  for (const connection of connections) {
    byProvider.set(connection.provider, [
      ...(byProvider.get(connection.provider) ?? []),
      connection,
    ]);
  }
  const bankPickerCountry = CURRENCY_TO_COUNTRY[ctx.workspace.currency] ?? "GB";

  // Accounting systems and mailbox scanning only make sense where invoices do,
  // so a Personal workspace never sees those tiles — and their connect routes
  // refuse them too, since a hidden tile is not a guard.
  const cards: IntegrationCardData[] = providersForWorkspace(ctx.workspace.type).map((provider) => ({
    id: provider.id,
    name: provider.name,
    description: provider.description,
    category: provider.category,
    capabilities: provider.capabilities,
    flow: provider.flow,
    configured: encryptionReady && isProviderConfigured(provider),
    missingEnvVars: [
      ...(encryptionReady ? [] : ["INTEGRATION_ENCRYPTION_KEY"]),
      ...provider.envVars.filter((envVar) => !process.env[envVar]),
    ],
    requiredEnvVars: [...provider.envVars, "INTEGRATION_ENCRYPTION_KEY"],
    syncable: provider.syncIntervalHours !== null,
    multiInstance: provider.multiInstance,
    bankPickerCountry,
    currency: ctx.workspace.currency,
    connections: (byProvider.get(provider.id) ?? []).map((connection) =>
      toConnectionData(provider.id, provider.name, connection)
    ),
  }));

  const connectedCard = params.connected
    ? cards.find((card) => card.id === params.connected)
    : undefined;
  // The banner is about the connection that was just made, which with several
  // banks connected is not simply "the provider's connection".
  const justConnected =
    connectedCard?.connections.find((entry) => entry.id === params.connection) ??
    connectedCard?.connections[connectedCard.connections.length - 1];
  const firstSyncEligible = Boolean(
    !locked &&
      justConnected &&
      connectedCard?.syncable &&
      connectedCard.capabilities.includes("transactions")
  );

  return (
    <>
      {locked ? (
        <Alert>
          <LockIcon className="size-4" />
          <AlertTitle>Integrations are a Business feature</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>
              Automatically sync bank transactions, pull invoices from your accounting software,
              ingest invoices from email and send alerts to Slack or Teams.
            </span>
            <Button asChild size="sm">
              <Link href="/billing">Upgrade plan</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {connectedCard && firstSyncEligible && justConnected ? (
        <FirstSyncBanner
          providerId={connectedCard.id}
          providerName={justConnected.institutionName ?? connectedCard.name}
          connectionId={justConnected.id}
          accountCount={justConnected.accounts.length || null}
        />
      ) : params.connected ? (
        <Alert>
          <CheckCircle2Icon className="size-4" />
          <AlertTitle>Connected</AlertTitle>
          <AlertDescription>
            {connectedCard?.name ?? params.connected} was connected successfully.
            {connectedCard?.syncable
              ? " The first sync will run automatically, or use Sync now."
              : ""}
          </AlertDescription>
        </Alert>
      ) : null}

      {params.error ? (
        <Alert variant="destructive">
          <TriangleAlertIcon className="size-4" />
          <AlertTitle>Connection failed</AlertTitle>
          <AlertDescription>{params.error}</AlertDescription>
        </Alert>
      ) : null}

      {!locked && !encryptionReady ? (
        <Alert>
          <TriangleAlertIcon className="size-4" />
          <AlertTitle>Setup required</AlertTitle>
          <AlertDescription>
            Set <code className="text-xs">INTEGRATION_ENCRYPTION_KEY</code> (generate with
            &quot;openssl rand -hex 32&quot;) to enable integrations. Tokens are encrypted at
            rest with AES-256-GCM.
          </AlertDescription>
        </Alert>
      ) : null}

      <IntegrationsGrid cards={cards} locked={locked} />
    </>
  );
}
