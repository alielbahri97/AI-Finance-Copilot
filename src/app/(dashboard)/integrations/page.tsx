import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2Icon, LockIcon, TriangleAlertIcon } from "lucide-react";

import { IntegrationCard } from "@/components/integrations/integration-card";
import type { IntegrationCardData } from "@/components/integrations/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import {
  CATEGORY_LABELS,
  getProviders,
  isProviderConfigured,
  type IntegrationCategory,
} from "@/lib/integrations/registry";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Integrations",
};

const CATEGORY_ORDER: IntegrationCategory[] = ["banking", "accounting", "productivity"];

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
    case "gocardless": {
      const accounts = metadata.accounts as string[] | undefined;
      return accounts?.length
        ? `${accounts.length} bank account${accounts.length > 1 ? "s" : ""} linked`
        : null;
    }
    default:
      return null;
  }
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const [entitlements, params] = await Promise.all([getEntitlements(user.id), searchParams]);

  if (!entitlements.plan.limits.integrationsEnabled) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground text-sm">
            Connect banks, accounting software and productivity tools
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="bg-muted flex size-12 items-center justify-center rounded-full">
              <LockIcon className="text-muted-foreground size-6" />
            </div>
            <p className="font-medium">Integrations are a Business feature</p>
            <p className="text-muted-foreground max-w-md text-sm">
              Automatically sync bank transactions, pull invoices from your accounting
              software, ingest invoices from email and send alerts to Slack or Teams.
            </p>
            <Button asChild size="sm">
              <Link href="/billing">Upgrade plan</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const encryptionReady = isEncryptionConfigured();
  const connections = await prisma.integrationConnection.findMany({
    where: { userId: user.id },
    include: {
      syncRuns: { orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));

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
      syncable: provider.syncIntervalHours !== null,
      connection: connection
        ? {
            status: connection.status,
            lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
            lastError: connection.lastError,
            accountLabel: accountLabel(provider.id, metadata),
            calendarEnabled: metadata.calendarEnabled === true,
            lastRunStats: (lastRun?.stats as Record<string, number> | null) ?? null,
          }
        : null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground text-sm">
          Connect banks, accounting software and productivity tools. Connected sources sync
          automatically every few hours.
        </p>
      </div>

      {params.connected ? (
        <Alert>
          <CheckCircle2Icon className="size-4" />
          <AlertTitle>Connected</AlertTitle>
          <AlertDescription>
            {cards.find((card) => card.id === params.connected)?.name ?? params.connected} was
            connected successfully. The first sync will run automatically, or use Sync now.
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

      {!encryptionReady ? (
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

      {CATEGORY_ORDER.map((category) => (
        <section key={category} className="space-y-3">
          <h2 className="text-lg font-medium">{CATEGORY_LABELS[category]}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards
              .filter((card) => card.category === category)
              .map((card) => (
                <IntegrationCard key={card.id} data={card} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
