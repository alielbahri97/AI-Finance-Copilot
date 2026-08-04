import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  PercentIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";

import { AgingTable } from "@/components/reports/aging-table";
import {
  CategoryBreakdown,
  MonthlyTrendChart,
  YearlyChart,
} from "@/components/reports/charts-lazy";
import { ExportButtons } from "@/components/reports/export-buttons";
import { PartyTable } from "@/components/reports/party-table";
import { PeriodSelector } from "@/components/reports/period-selector";
import {
  ChartRowSkeleton,
  StatRowSkeleton,
} from "@/components/dashboard/section-skeletons";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getEntitlements } from "@/lib/billing/entitlements";
import { buildReport } from "@/lib/reports/data";
import { resolvePeriod, type ResolvedPeriod } from "@/lib/reports/period";
import { formatCurrency } from "@/lib/utils";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

interface ReportsPageProps {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}

/** Streams: header + period selector paint first, KPIs/charts follow. */
export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("view_reports")) redirect("/dashboard");
  const canExport = ctx.permissions.has("export_data");

  const params = await searchParams;
  const period = resolvePeriod(params.period, params.from, params.to);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Executive reports</h1>
          <p className="text-muted-foreground text-sm">
            KPIs, trends and exports for {period.label}.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <PeriodSelector />
          {canExport && (
            <Suspense fallback={<Skeleton className="h-9 w-64" />}>
              <ExportButtonsSection workspaceId={ctx.workspace.id} />
            </Suspense>
          )}
        </div>
      </div>

      <Suspense
        fallback={
          <>
            <StatRowSkeleton />
            <StatRowSkeleton count={3} />
            <ChartRowSkeleton />
          </>
        }
      >
        <ReportBody ctx={ctx} period={period} />
      </Suspense>
    </div>
  );
}

async function ExportButtonsSection({ workspaceId }: { workspaceId: string }) {
  const entitlements = await getEntitlements(workspaceId);
  return <ExportButtons locked={!entitlements.plan.limits.exportsEnabled} />;
}

async function ReportBody({ ctx, period }: { ctx: WorkspaceContext; period: ResolvedPeriod }) {
  const currency = ctx.workspace.currency;
  const report = await buildReport(ctx.workspace.id, currency, period);
  const { kpis } = report;

  const marginDelta =
    kpis.marginPct !== null && kpis.marginPrevPct !== null
      ? Math.round((kpis.marginPct - kpis.marginPrevPct) * 10) / 10
      : null;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Revenue"
          value={formatCurrency(kpis.revenue, currency)}
          hint="vs. previous period"
          icon={TrendingUpIcon}
          changePct={kpis.revenueChangePct}
          increaseIsGood
        />
        <StatCard
          title="Expenses"
          value={formatCurrency(kpis.expenses, currency)}
          hint="vs. previous period"
          icon={TrendingDownIcon}
          changePct={kpis.expensesChangePct}
          increaseIsGood={false}
        />
        <StatCard
          title="Profit (net)"
          value={formatCurrency(kpis.profit, currency)}
          hint="vs. previous period"
          icon={WalletIcon}
          changePct={kpis.profitChangePct}
          increaseIsGood
          tone={kpis.profit >= 0 ? "positive" : "negative"}
        />
        <StatCard
          title="Profit margin"
          value={kpis.marginPct === null ? "—" : `${kpis.marginPct}%`}
          hint={
            marginDelta === null
              ? "Profit as a share of revenue"
              : `${marginDelta > 0 ? "+" : ""}${marginDelta} pts vs. previous period`
          }
          icon={PercentIcon}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Cash"
          value={formatCurrency(kpis.cash, currency)}
          hint="Balance at the end of the period"
          icon={WalletIcon}
          tone={kpis.cash >= 0 ? "positive" : "negative"}
        />
        <StatCard
          title="Accounts receivable"
          value={formatCurrency(kpis.accountsReceivable, currency)}
          hint="Unpaid invoices you issued"
          icon={BanknoteArrowUpIcon}
        />
        <StatCard
          title="Accounts payable"
          value={formatCurrency(kpis.accountsPayable, currency)}
          hint="Unpaid bills you owe"
          icon={BanknoteArrowDownIcon}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Monthly trend</CardTitle>
            <CardDescription>Revenue, expenses and profit per month in the period</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyTrendChart data={report.monthly} currency={currency} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Year over year</CardTitle>
            <CardDescription>Annual revenue, expenses and profit</CardDescription>
          </CardHeader>
          <CardContent>
            <YearlyChart data={report.yearly} currency={currency} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Expenses by category</CardTitle>
            <CardDescription>Where money went in the period</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryBreakdown
              data={report.expenseCategories}
              currency={currency}
              emptyLabel="No expenses in this period"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Income by category</CardTitle>
            <CardDescription>Where money came from in the period</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryBreakdown
              data={report.incomeCategories}
              currency={currency}
              emptyLabel="No income in this period"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top vendors</CardTitle>
            <CardDescription>Highest spend by counterparty</CardDescription>
          </CardHeader>
          <CardContent>
            <PartyTable
              data={report.topVendors}
              currency={currency}
              partyLabel="Vendor"
              emptyLabel="No vendor spend in this period"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top customers</CardTitle>
            <CardDescription>Highest income by counterparty</CardDescription>
          </CardHeader>
          <CardContent>
            <PartyTable
              data={report.topCustomers}
              currency={currency}
              partyLabel="Customer"
              emptyLabel="No customer income in this period"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>AR aging</CardTitle>
            <CardDescription>Outstanding receivables by days overdue</CardDescription>
          </CardHeader>
          <CardContent>
            <AgingTable buckets={report.arAging} currency={currency} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>AP aging</CardTitle>
            <CardDescription>Outstanding payables by days overdue</CardDescription>
          </CardHeader>
          <CardContent>
            <AgingTable buckets={report.apAging} currency={currency} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
