import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LockIcon, TriangleAlertIcon } from "lucide-react";

import { HoldingsManager } from "@/components/net-worth/holdings-manager";
import { NetWorthChart } from "@/components/net-worth/net-worth-chart";
import { NetWorthSummaryCard } from "@/components/net-worth/net-worth-summary";
import type { HoldingRow } from "@/components/net-worth/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getEntitlements } from "@/lib/billing/entitlements";
import { EDITION_PLAN_ORDER, getPlan } from "@/lib/billing/plans";
import {
  getNetWorthOverview,
  type ValuationRow,
} from "@/lib/personal/net-worth-data";
import { HISTORY_MONTHS, type AssetPosition } from "@/lib/personal/net-worth";
import { getWorkspaceContext } from "@/lib/workspace/context";
import { editionHasFeature } from "@/lib/workspace/editions";

export const metadata: Metadata = { title: "Net worth" };
export const dynamic = "force-dynamic";

/** Date inputs and the shared formatter both want a plain calendar day. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toRow(
  position: AssetPosition,
  valuations: ValuationRow[] | undefined
): HoldingRow {
  return {
    id: position.id,
    name: position.name,
    kind: position.kind,
    isLiability: position.isLiability,
    currency: position.currency,
    note: position.note,
    value: position.value,
    asOf: position.asOf ? isoDay(position.asOf) : null,
    valuationCount: position.valuationCount,
    change: position.change,
    reason: position.reason,
    valuations: (valuations ?? []).map((valuation) => ({
      id: valuation.id,
      value: valuation.value,
      asOf: isoDay(valuation.asOf),
    })),
  };
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Net worth</h1>
      <p className="text-muted-foreground text-sm">
        Everything you own, less everything you owe — your bank balances plus the things
        they cannot see, month by month.
      </p>
    </div>
  );
}

export default async function NetWorthPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  // In a Business workspace the feature does not exist, so neither does the URL.
  if (!editionHasFeature(ctx.workspace.type, "netWorth")) notFound();
  if (!ctx.permissions.has("view_reports")) redirect("/dashboard");

  const [entitlements, overview] = await Promise.all([
    getEntitlements(ctx.workspace.id),
    getNetWorthOverview(ctx.workspace.id, ctx.workspace.currency),
  ]);

  const currency = ctx.workspace.currency;
  // Only the *manual* half is plan-gated: net worth from synced balances is
  // real on every tier, so Free gets the figure and the chart and is told what
  // adding a house and a mortgage would do, rather than meeting a locked page.
  const manualEnabled = entitlements.plan.limits.netWorthEnabled;
  const upgradeTo = manualEnabled
    ? null
    : EDITION_PLAN_ORDER[entitlements.edition]
        .map((planId) => getPlan(planId, entitlements.edition))
        .find((plan) => plan.limits.netWorthEnabled);

  const canEdit = manualEnabled && ctx.permissions.has("edit_transactions");

  // A workspace that downgraded from Plus still has its holdings, and they are
  // still in the total above — so the tables stay, read-only, rather than
  // leaving the summary to mention holdings the page then refuses to show.
  const holdings = overview.position.assets.length + overview.position.liabilities.length;
  const showHoldings = manualEnabled || holdings > 0;

  return (
    <div className="space-y-6">
      <PageHeader />

      <NetWorthSummaryCard
        position={overview.position}
        trend={overview.trend}
        cash={overview.cash}
        months={HISTORY_MONTHS}
      />

      {overview.assetsAvailable ? null : (
        <Alert>
          <TriangleAlertIcon className="size-4" />
          <AlertTitle>Showing cash only</AlertTitle>
          <AlertDescription>
            Assets and debts are not available on this deployment yet — the database
            migration has not been applied. The figure above is your synced cash.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Over time</CardTitle>
          <CardDescription>
            The last {HISTORY_MONTHS} months. A holding counts from its first recorded
            value onwards, and its last known value carries forward through months you
            did not revalue it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NetWorthChart data={overview.history} currency={currency} />
        </CardContent>
      </Card>

      {manualEnabled ? null : (
        <Alert>
          <LockIcon className="size-4" />
          <AlertTitle>
            Assets and debts are part of {upgradeTo?.name ?? "the paid plans"}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>
              You are on {entitlements.plan.name}, which tracks net worth from your
              connected accounts. Upgrading adds the things your banks cannot see — a
              house, a car, investments, a mortgage — each with its own value history.
              {holdings > 0
                ? " What you have already entered still counts towards the figure above; upgrade to change it or add more."
                : ""}
            </span>
            <Button asChild size="sm">
              <Link href="/billing">Upgrade plan</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {showHoldings ? (
        <HoldingsManager
          assets={overview.position.assets.map((asset) =>
            toRow(asset, overview.valuations[asset.id])
          )}
          liabilities={overview.position.liabilities.map((liability) =>
            toRow(liability, overview.valuations[liability.id])
          )}
          assetTotal={overview.position.assetTotal}
          liabilityTotal={overview.position.liabilityTotal}
          currency={currency}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}
