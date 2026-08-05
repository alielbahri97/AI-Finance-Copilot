import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashPosition } from "@/lib/finance/cash";
import type { NetWorthPosition, NetWorthTrend } from "@/lib/personal/net-worth";
import { formatCurrency } from "@/lib/utils";

interface NetWorthSummaryProps {
  position: NetWorthPosition;
  trend: NetWorthTrend;
  cash: CashPosition;
  months: number;
}

/**
 * The headline figure and what it is made of. Server-rendered from plain props.
 *
 * The cash row names its source, because "where did that number come from" is
 * the first question a net-worth page has to answer: either the connected banks
 * said so, or it is the running total of the transactions that have been
 * imported.
 */
export function NetWorthSummaryCard({
  position,
  trend,
  cash,
  months,
}: NetWorthSummaryProps) {
  const money = (value: number) => formatCurrency(value, position.currency);
  const rising = trend.change !== null && trend.change > 0;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Net worth</CardTitle>
        <CardDescription>
          {trend.change === null
            ? "Everything you own, less everything you owe."
            : `${rising ? "Up" : "Down"} ${money(Math.abs(trend.change))} over the last ${months} months${
                trend.changePct === null ? "" : ` (${rising ? "+" : "−"}${Math.abs(trend.changePct)}%)`
              }.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-bold tracking-tight tabular-nums">
            {money(position.netWorth)}
          </span>
          {trend.monthChange !== null && trend.monthChange !== 0 ? (
            <span
              className={
                trend.monthChange > 0
                  ? "text-success text-sm tabular-nums"
                  : "text-destructive text-sm tabular-nums"
              }
            >
              {trend.monthChange > 0 ? "+" : "−"}
              {money(Math.abs(trend.monthChange))} this month
            </span>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground text-xs">Assets</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {money(position.totalAssets)}
            </dd>
            <p className="text-muted-foreground text-xs">
              {position.assets.length === 0
                ? "Cash only"
                : `${position.assets.length} tracked, plus cash`}
            </p>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Debts</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {money(position.liabilityTotal)}
            </dd>
            <p className="text-muted-foreground text-xs">
              {position.liabilities.length === 0
                ? "Nothing recorded"
                : `${position.liabilities.length} recorded`}
            </p>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Cash</dt>
            <dd className="text-lg font-semibold tabular-nums">{money(position.cash)}</dd>
            <p className="text-muted-foreground text-xs">
              {cash.source === "bank"
                ? `From ${cash.countedAccounts} connected account${cash.countedAccounts === 1 ? "" : "s"}`
                : "From your transaction history"}
            </p>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Owned outright</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {position.totalAssets > 0
                ? `${Math.round(((position.totalAssets - position.liabilityTotal) / position.totalAssets) * 100)}%`
                : "—"}
            </dd>
            <p className="text-muted-foreground text-xs">
              Share of your assets that is not borrowed
            </p>
          </div>
        </dl>

        {position.otherCurrencyCount > 0 || cash.hasOtherCurrency ? (
          <p className="text-muted-foreground text-xs">
            {[
              position.otherCurrencyCount > 0
                ? `${position.otherCurrencyCount} holding${position.otherCurrencyCount === 1 ? "" : "s"}`
                : null,
              cash.hasOtherCurrency ? "at least one account" : null,
            ]
              .filter(Boolean)
              .join(" and ")}{" "}
            {position.otherCurrencyCount + (cash.hasOtherCurrency ? 1 : 0) === 1
              ? "is"
              : "are"}{" "}
            held in another currency, and left out of the total. Ballast has no exchange
            rates and will not invent one.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
