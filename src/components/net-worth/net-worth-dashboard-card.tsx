import Link from "next/link";
import { ScaleIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HISTORY_MONTHS } from "@/lib/personal/net-worth";
import { getNetWorthOverview } from "@/lib/personal/net-worth-data";
import { formatCurrency } from "@/lib/utils";

/**
 * The dashboard's net-worth card.
 *
 * It loads its own figures rather than taking props, which keeps the shared
 * dashboard file down to one import and one Suspense boundary; the loader is
 * request-memoized, so the /net-worth page and this card share a round trip
 * when both render.
 *
 * Renders nothing until at least one holding exists. With no holdings net worth
 * *is* the cash balance, and the dashboard already has a cash card — a second
 * card repeating it would be noise rather than information.
 */
export async function NetWorthDashboardCard({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: string;
}) {
  const overview = await getNetWorthOverview(workspaceId, currency);
  const { position, trend } = overview;
  if (position.assets.length === 0 && position.liabilities.length === 0) return null;

  const money = (value: number) => formatCurrency(value, currency);
  const rising = trend.change !== null && trend.change > 0;

  return (
    <Card className="h-full gap-3">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Net worth</CardTitle>
          <CardDescription>
            {trend.change === null || trend.change === 0
              ? "What you own, less what you owe"
              : `${rising ? "Up" : "Down"} ${money(Math.abs(trend.change))} over ${HISTORY_MONTHS} months`}
          </CardDescription>
        </div>
        <ScaleIcon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-2xl font-bold tracking-tight tabular-nums">
          {money(position.netWorth)}
        </p>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs">Assets</dt>
            <dd className="font-medium tabular-nums">{money(position.totalAssets)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Debts</dt>
            <dd className="font-medium tabular-nums">{money(position.liabilityTotal)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Cash</dt>
            <dd className="font-medium tabular-nums">{money(position.cash)}</dd>
          </div>
        </dl>
        <Link
          href="/net-worth"
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
        >
          {position.unvaluedCount > 0
            ? `${position.unvaluedCount} holding${position.unvaluedCount === 1 ? "" : "s"} still needs a value`
            : "Full breakdown and history"}
        </Link>
      </CardContent>
    </Card>
  );
}
