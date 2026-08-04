import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2Icon, LockIcon, TriangleAlertIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { FirstSyncBanner } from "@/components/integrations/first-sync-banner";
import { IntegrationsGrid } from "@/components/integrations/integrations-grid";
import type { IntegrationCardData } from "@/components/integrations/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { getProviders, isProviderConfigured } from "@/lib/integrations/registry";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = {
  title: "Integrations",
};

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

function gocardlessLabel(metadata: Record<string, unknown>): string | null {
  const accounts = metadata.accounts as string[] | undefined;
  if (!accounts?.length) return null;

  const parts: string[] = [];
  if (typeof metadata.institutionName === "string" && metadata.institutionName) {
    parts.push(metadata.institutionName);
  }
  parts.push(`${accounts.length} account${accounts.length > 1 ? "s" : ""}`);

  // Balance summary when every account reports the same currency.
  const balances = metadata.balances as
    | Record<string, { amount: number; currency: string }>
    | undefined;
  const entries = accounts.map((id) => balances?.[id]).filter(Boolean) as Array<{
    amount: number;
    currency: string;
  }>;
  if (entries.length > 0 && entries.every((entry) => entry.currency === entries[0].currency)) {
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    parts.push(
      `${new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: entries[0].currency,
      }).format(total)} available`
    );
  }
  return parts.join(" · ");
}

function accountLabel(provider: string, metadata: Record<string, unknown>): string | null {
  switch (provider) {
    case "slack":
      return metadata.channel ? `Posting to ${metadata.channel}` : null;
    case "xero":
      return metadata.tenantName ? `Organisation: ${metadata.tenantName}` : null;
    case "plaid":
      return metadata.institution ? `Institution: ${metadata.institution}` : null;
    case "quickbooks":
      return metadata.realmId ? `Company ${metadata.realmId}` : null;
    case "exact":
      return metadata.division ? `Division ${metadata.division}` : null;
    case "gocardless":
      return gocardlessLabel(metadata);
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

type IntegrationsParams = { connected?: string; error?: string };

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground text-sm">
          Pick a tool to see what it does and how to connect it. Connected sources sync
          automatically every few hours.
        </p>
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
    prisma.integrationConnection.findMany({
      where: { workspaceId: ctx.workspace.id },
      include: {
        syncRuns: { orderBy: { startedAt: "desc" }, take: 1 },
      },
    }),
  ]);
  const locked = !entitlements.plan.limits.integrationsEnabled;
  const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));
  const bankPickerCountry = CURRENCY_TO_COUNTRY[ctx.workspace.currency] ?? "GB";

  const cards: IntegrationCardData[] = getProviders().map((provider) => {
    const connection = byProvider.get(provider.id);
    const metadata = (connection?.metadata as Record<string, unknown> | null) ?? {};
    const lastRun = connection?.syncRuns[0];
    return {
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
      bankPickerCountry,
      connection: connection
        ? {
            status: connection.status,
            lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
            lastError: connection.lastError,
            accountLabel: accountLabel(provider.id, metadata),
            calendarEnabled: metadata.calendarEnabled === true,
            lastRunStats: (lastRun?.stats as Record<string, number> | null) ?? null,
            consentExpiresAt:
              typeof metadata.consentExpiresAt === "string" ? metadata.consentExpiresAt : null,
            rateLimitedUntil: rateLimitedUntil(metadata),
          }
        : null,
    };
  });

  const connectedCard = params.connected
    ? cards.find((card) => card.id === params.connected)
    : undefined;
  const firstSyncEligible = Boolean(
    !locked &&
      connectedCard?.connection &&
      connectedCard.syncable &&
      connectedCard.capabilities.includes("transactions")
  );
  const connectedMetadata =
    (byProvider.get(connectedCard?.id ?? "")?.metadata as Record<string, unknown> | null) ?? {};
  const connectedAccountCount = Array.isArray(connectedMetadata.accounts)
    ? connectedMetadata.accounts.length
    : null;

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

      {connectedCard && firstSyncEligible ? (
        <FirstSyncBanner
          providerId={connectedCard.id}
          providerName={connectedCard.name}
          accountCount={connectedAccountCount}
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
