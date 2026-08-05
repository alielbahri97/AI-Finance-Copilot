import { Suspense } from "react";
import Link from "next/link";
import {
  CalendarClockIcon,
  PiggyBankIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";

import { BudgetWidget } from "@/components/budgets/budget-widget";
import { CashCard } from "@/components/dashboard/cash-card";
import { ChartsSection } from "@/components/dashboard/charts-section";
import {
  ChartRowSkeleton,
  StatRowSkeleton,
  TableCardSkeleton,
} from "@/components/dashboard/section-skeletons";
import { StatCard } from "@/components/dashboard/stat-card";
import { UpcomingBills } from "@/components/forecast/upcoming-bills";
import { GoalsWidget } from "@/components/goals/goals-widget";
import { NetWorthDashboardCard } from "@/components/net-worth/net-worth-dashboard-card";
import { SubscriptionsWidget } from "@/components/subscriptions/subscriptions-widget";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PlanLimits } from "@/lib/billing/plans";
import { getDashboardData } from "@/lib/data";
import { buildForecast } from "@/lib/finance/data";
import { getBudgetOverview } from "@/lib/personal/budgets-data";
import { periodOf } from "@/lib/personal/budgets";
import { getGoalsOverview } from "@/lib/personal/goals-data";
import { getSubscriptionsOverview } from "@/lib/personal/subscriptions-data";
import { formatCurrency } from "@/lib/utils";

/**
 * The Personal edition's dashboard: what a person actually wants to know on a
 * Tuesday evening — how much came in and went out, what is left, whether they
 * are inside their budgets, what is about to be charged, and how the saving is
 * going. The business KPI set (revenue, margin, runway, invoices) is absent
 * because none of it is a question about a household.
 *
 * Everything below the header streams independently, and the two paid widgets
 * are omitted rather than teased when the plan does not include them — the
 * Goals and Subscriptions pages make the upgrade case in full.
 */
interface PersonalDashboardProps {
  workspaceId: string;
  currency: string;
  limits: PlanLimits;
  canViewTransactions: boolean;
  canViewReports: boolean;
}

export function PersonalDashboard({
  workspaceId,
  currency,
  limits,
  canViewTransactions,
  canViewReports,
}: PersonalDashboardProps) {
  return (
    <>
      {canViewTransactions && (
        <Suspense fallback={<StatRowSkeleton />}>
          <PersonalStats workspaceId={workspaceId} currency={currency} />
        </Suspense>
      )}

      {canViewTransactions && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <Suspense fallback={<TableCardSkeleton rows={5} />}>
              <BudgetSection workspaceId={workspaceId} currency={currency} />
            </Suspense>
          </div>
          <div className="lg:col-span-2">
            <Suspense fallback={<TableCardSkeleton rows={5} />}>
              <BillsSection workspaceId={workspaceId} currency={currency} />
            </Suspense>
          </div>
        </div>
      )}

      {canViewTransactions &&
        (limits.goalsEnabled ||
          limits.subscriptionInsightsEnabled ||
          limits.netWorthEnabled) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {limits.goalsEnabled && (
              <Suspense fallback={<TableCardSkeleton rows={4} />}>
                <GoalsSection workspaceId={workspaceId} currency={currency} />
              </Suspense>
            )}
            {limits.subscriptionInsightsEnabled && (
              <Suspense fallback={<TableCardSkeleton rows={4} />}>
                <SubscriptionsSection workspaceId={workspaceId} currency={currency} />
              </Suspense>
            )}
            {/* Renders nothing until a holding exists: with none, net worth is
                the cash figure the stat row already shows. */}
            {limits.netWorthEnabled && (
              <Suspense fallback={<TableCardSkeleton rows={3} />}>
                <NetWorthDashboardCard workspaceId={workspaceId} currency={currency} />
              </Suspense>
            )}
          </div>
        )}

      {canViewReports && (
        <Suspense
          fallback={
            <>
              <ChartRowSkeleton />
              <ChartRowSkeleton />
              <TableCardSkeleton rows={6} />
            </>
          }
        >
          <ChartsSection workspaceId={workspaceId} currency={currency} edition="personal" />
        </Suspense>
      )}
    </>
  );
}

/**
 * Money in, money out, what is on hand, and what the budgets have left. The
 * fourth card falls back to the savings rate when no budget exists yet, so the
 * row never renders a card with nothing in it.
 */
async function PersonalStats({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: string;
}) {
  const [data, budgets] = await Promise.all([
    getDashboardData(workspaceId),
    getBudgetOverview(workspaceId, periodOf(new Date())),
  ]);
  const summary = budgets.summary;
  const hasBudgets = summary.budgets.length > 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title="Money in this month"
        value={formatCurrency(data.monthIncome, currency)}
        hint="vs. previous month"
        icon={TrendingUpIcon}
        changePct={data.incomeChangePct}
        increaseIsGood
      />
      <StatCard
        title="Money out this month"
        value={formatCurrency(data.monthExpenses, currency)}
        hint="vs. previous month"
        icon={TrendingDownIcon}
        changePct={data.expensesChangePct}
        increaseIsGood={false}
      />
      <CashCard cash={data.cash} />
      {hasBudgets ? (
        <StatCard
          title={summary.totalRemaining < 0 ? "Over budget" : "Left to spend"}
          value={formatCurrency(Math.abs(summary.totalRemaining), currency)}
          hint={`of ${formatCurrency(summary.totalAvailable, currency)} budgeted this month`}
          icon={WalletIcon}
          tone={summary.totalRemaining < 0 ? "negative" : "default"}
        />
      ) : (
        <StatCard
          title="Kept this month"
          value={`${data.savingsRate}%`}
          hint="Share of this month's income you didn't spend"
          icon={PiggyBankIcon}
        />
      )}
    </div>
  );
}

async function BudgetSection({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: string;
}) {
  const overview = await getBudgetOverview(workspaceId, periodOf(new Date()));
  return <BudgetWidget summary={overview.summary} currency={currency} />;
}

/**
 * The bills the forecast already schedules from detected recurring payments —
 * the same list the Forecast page shows, which is the answer to "what is about
 * to come out?".
 */
async function BillsSection({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: string;
}) {
  const forecast = await buildForecast(workspaceId, currency);
  const bills = forecast.upcomingBills.slice(0, 6);
  const total = bills.reduce((sum, bill) => sum + bill.amount, 0);

  return (
    <Card className="h-full gap-3">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Upcoming bills</CardTitle>
          <CardDescription>
            {bills.length === 0
              ? "Next 45 days"
              : `${formatCurrency(total, currency)} due in the next 45 days`}
          </CardDescription>
        </div>
        <CalendarClockIcon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <UpcomingBills bills={bills} currency={currency} />
        {forecast.upcomingBills.length > bills.length && (
          <Link
            href="/forecast"
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
          >
            All {forecast.upcomingBills.length} upcoming bills
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

async function GoalsSection({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: string;
}) {
  const overview = await getGoalsOverview(workspaceId);
  return <GoalsWidget summary={overview.summary} currency={currency} />;
}

async function SubscriptionsSection({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: string;
}) {
  const analysis = await getSubscriptionsOverview(workspaceId);
  return (
    <SubscriptionsWidget
      currency={currency}
      totalMonthlyCost={analysis.totalMonthlyCost}
      subscriptionCount={analysis.subscriptions.length}
      flaggedCount={analysis.flaggedCount}
      upcomingCharges={analysis.upcomingCharges}
    />
  );
}
