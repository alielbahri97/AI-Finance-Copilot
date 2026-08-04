import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarClockIcon,
  FlameIcon,
  HourglassIcon,
  LockIcon,
  RepeatIcon,
  WalletIcon,
} from "lucide-react";

import {
  ChartRowSkeleton,
  StatRowSkeleton,
} from "@/components/dashboard/section-skeletons";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  AssumptionsManager,
  type AssumptionItem,
} from "@/components/forecast/assumptions-manager";
import { ExplainForecast } from "@/components/forecast/explain-forecast";
import { ForecastChart } from "@/components/forecast/forecast-chart-lazy";
import { RecurringTable } from "@/components/forecast/recurring-table";
import { UpcomingBills } from "@/components/forecast/upcoming-bills";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getEntitlements } from "@/lib/billing/entitlements";
import { buildForecast } from "@/lib/finance/data";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Forecast" };
export const dynamic = "force-dynamic";

function runwayDisplay(months: number | null): { value: string; hint: string } {
  if (months === null) {
    return { value: "∞", hint: "Projected cash-flow positive" };
  }
  if (months <= 0) {
    return { value: "0 months", hint: "Balance is already at or below zero" };
  }
  return {
    value: `${Math.round(months * 10) / 10} months`,
    hint: "Until cash reaches zero on the current trajectory",
  };
}

/** Streams: the header paints immediately, the forecast body follows. */
export default async function ForecastPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("view_reports")) redirect("/dashboard");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cash flow forecast</h1>
        <p className="text-muted-foreground text-sm">
          Deterministic projection from your recurring patterns, spending trend and assumptions.
        </p>
      </div>

      <Suspense
        fallback={
          <>
            <StatRowSkeleton />
            <ChartRowSkeleton />
          </>
        }
      >
        <ForecastContent ctx={ctx} />
      </Suspense>
    </div>
  );
}

async function ForecastContent({ ctx }: { ctx: WorkspaceContext }) {
  const workspaceId = ctx.workspace.id;

  // Assumptions are fetched once and shared with the forecast engine
  // (buildForecast used to fetch its own copy — one duplicate query saved).
  const assumptionsPromise = prisma.assumption.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
  const [forecast, assumptionRows, entitlements] = await Promise.all([
    assumptionsPromise.then((rows) => buildForecast(workspaceId, ctx.workspace.currency, rows)),
    assumptionsPromise,
    getEntitlements(workspaceId),
  ]);
  const assumptionsUnlocked = entitlements.plan.limits.assumptionsEnabled;

  const assumptions: AssumptionItem[] = assumptionRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    type: row.type,
    label: row.label,
    amount: row.amount === null ? null : Number(row.amount),
    percent: row.percent === null ? null : Number(row.percent),
    date: row.date?.toISOString().slice(0, 10) ?? null,
    startDate: row.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
    enabled: row.enabled,
  }));

  const { metrics } = forecast;
  const runway = runwayDisplay(metrics.runwayMonths);
  const isBurning = metrics.netBurnRate > 0;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Cash runway"
          value={runway.value}
          hint={runway.hint}
          icon={HourglassIcon}
          tone={metrics.runwayMonths === null ? "positive" : metrics.runwayMonths < 6 ? "negative" : "default"}
        />
        <StatCard
          title={isBurning ? "Net burn rate" : "Net cash added"}
          value={`${formatCurrency(Math.abs(metrics.netBurnRate), ctx.workspace.currency)}/mo`}
          hint={`Gross expenses ${formatCurrency(metrics.grossBurnRate, ctx.workspace.currency)}/mo (3-month avg)`}
          icon={FlameIcon}
          tone={isBurning ? "negative" : "positive"}
        />
        <StatCard
          title="Recurring expenses"
          value={`${formatCurrency(metrics.recurringMonthlyExpenses, ctx.workspace.currency)}/mo`}
          hint={`Recurring income ${formatCurrency(metrics.recurringMonthlyIncome, ctx.workspace.currency)}/mo`}
          icon={RepeatIcon}
        />
        <StatCard
          title="Balance in 30 days"
          value={formatCurrency(metrics.projectedBalance30d, ctx.workspace.currency)}
          hint={`90 days: ${formatCurrency(metrics.projectedBalance90d, ctx.workspace.currency)} · 12 months: ${formatCurrency(metrics.projectedBalance12m, ctx.workspace.currency)}`}
          icon={WalletIcon}
          tone={metrics.projectedBalance30d >= 0 ? "default" : "negative"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Projected balance</CardTitle>
          <CardDescription>
            Historical actuals and the projected trajectory with an ~80% confidence band
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForecastChart horizons={forecast.horizons} currency={ctx.workspace.currency} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI explanation</CardTitle>
          <CardDescription>Drivers, risks and recommendations for this forecast</CardDescription>
        </CardHeader>
        <CardContent>
          <ExplainForecast />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Assumptions</CardTitle>
            <CardDescription>
              One-off amounts, monthly adjustments and % growth applied to the projection
            </CardDescription>
          </CardHeader>
          <CardContent>
            {assumptionsUnlocked ? (
              <AssumptionsManager assumptions={assumptions} currency={ctx.workspace.currency} />
            ) : (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="bg-muted flex size-10 items-center justify-center rounded-full">
                  <LockIcon className="text-muted-foreground size-5" />
                </div>
                <p className="text-sm font-medium">What-if assumptions are a Pro feature</p>
                <p className="text-muted-foreground max-w-sm text-sm">
                  Model new hires, expected payments and growth scenarios on top of your forecast.
                </p>
                <Button asChild size="sm">
                  <Link href="/billing">Upgrade plan</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClockIcon className="size-4" />
              Upcoming bills
            </CardTitle>
            <CardDescription>Projected recurring payments over the next 45 days</CardDescription>
          </CardHeader>
          <CardContent>
            <UpcomingBills bills={forecast.upcomingBills} currency={ctx.workspace.currency} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recurring expenses</CardTitle>
            <CardDescription>
              Detected from your history · {formatCurrency(metrics.recurringMonthlyExpenses, ctx.workspace.currency)}
              /month total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecurringTable
              items={forecast.recurringExpenses}
              currency={ctx.workspace.currency}
              emptyMessage="No recurring expenses detected yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recurring income</CardTitle>
            <CardDescription>
              Detected from your history · {formatCurrency(metrics.recurringMonthlyIncome, ctx.workspace.currency)}
              /month total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecurringTable
              items={forecast.recurringIncome}
              currency={ctx.workspace.currency}
              emptyMessage="No recurring income detected yet."
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
