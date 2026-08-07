import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  LandmarkIcon,
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
import { ReportBodySkeleton } from "@/components/reports/report-skeletons";
import { StatCard, StatRow } from "@/components/dashboard/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
import { Skeleton } from "@/components/ui/skeleton";
import { getEntitlements } from "@/lib/billing/entitlements";
import { buildReport } from "@/lib/reports/data";
import { resolvePeriod, type ResolvedPeriod } from "@/lib/reports/period";
import { formatCurrency, localeForCurrency } from "@/lib/utils";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";
import { editionHasFeature } from "@/lib/workspace/editions";

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
  // Counterparty analysis (vendors, customers, AR/AP) is the business half of
  // this page; a Personal workspace keeps the trends and category breakdowns.
  const counterparties = editionHasFeature(ctx.workspace.type, "counterparties");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <PageHeading>
            {counterparties ? "Executive reports" : "Reports"}
          </PageHeading>
          <p className="text-muted-foreground text-sm">
            {counterparties
              ? `Your numbers for ${period.label}.`
              : `Where your money went in ${period.label}.`}
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

      <Suspense fallback={<ReportBodySkeleton />}>
        <ReportBody ctx={ctx} period={period} />
      </Suspense>
    </div>
  );
}

async function ExportButtonsSection({ workspaceId }: { workspaceId: string }) {
  const entitlements = await getEntitlements(workspaceId);
  return <ExportButtons paidLocked={!entitlements.plan.limits.exportsEnabled} />;
}

async function ReportBody({ ctx, period }: { ctx: WorkspaceContext; period: ResolvedPeriod }) {
  const currency = ctx.workspace.currency;
  const report = await buildReport(ctx.workspace.id, currency, period);
  const { kpis } = report;
  const counterparties = editionHasFeature(ctx.workspace.type, "counterparties");
  const locale = localeForCurrency(currency);
  const money = (value: number) => formatCurrency(value, currency, locale);

  const marginDelta =
    kpis.marginPct !== null && kpis.marginPrevPct !== null
      ? Math.round((kpis.marginPct - kpis.marginPrevPct) * 10) / 10
      : null;

  /**
   * Margin is profit over revenue, so it belongs on the profit card rather than
   * competing with it as a KPI of its own.
   */
  const profitHint =
    kpis.marginPct === null
      ? "Revenue minus expenses, vs. previous period"
      : marginDelta === null
        ? `${kpis.marginPct}% margin, vs. previous period`
        : `${kpis.marginPct}% margin · ${marginDelta > 0 ? "+" : ""}${marginDelta} pts vs. previous period`;

  const cashHint =
    kpis.cashSource === "bank"
      ? "Combined balance of your connected accounts"
      : "Balance at the end of the period";

  return (
    <>
      {/*
       * Profit is the hero: this page is period-scoped (every other figure and
       * both charts are "for this period"), and profit is the one number the
       * period produced. Cash is a balance at a moment rather than a result of
       * the period, and it already headlines the dashboard.
       */}
      <StatRow>
        <StatCard
          title={counterparties ? "Profit (net)" : "Kept"}
          value={money(kpis.profit)}
          hint={counterparties ? profitHint : "What was left after expenses, vs. previous period"}
          icon={WalletIcon}
          changePct={kpis.profitChangePct}
          increaseIsGood
          tone={kpis.profit >= 0 ? "positive" : "negative"}
          emphasis="hero"
        />
        <StatCard
          title={counterparties ? "Revenue" : "Money in"}
          value={money(kpis.revenue)}
          hint="vs. previous period"
          icon={TrendingUpIcon}
          changePct={kpis.revenueChangePct}
          increaseIsGood
        />
        <StatCard
          title={counterparties ? "Expenses" : "Money out"}
          value={money(kpis.expenses)}
          hint="vs. previous period"
          icon={TrendingDownIcon}
          changePct={kpis.expensesChangePct}
          increaseIsGood={false}
        />
        <StatCard
          title={counterparties ? "Cash" : "Balance"}
          value={money(kpis.cash)}
          hint={cashHint}
          icon={LandmarkIcon}
          tone={kpis.cash >= 0 ? "positive" : "negative"}
        />
      </StatRow>

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

      {counterparties && (
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
      )}

      {/*
       * AR and AP are the totals of the two tables underneath them, so each one
       * sits on top of its own breakdown instead of floating in the KPI row.
       */}
      {counterparties && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <StatCard
              title="Accounts receivable"
              value={money(kpis.accountsReceivable)}
              hint="Unpaid invoices you issued"
              icon={BanknoteArrowUpIcon}
            />
            <Card>
              <CardHeader>
                <CardTitle>AR aging</CardTitle>
                <CardDescription>Outstanding receivables by days overdue</CardDescription>
              </CardHeader>
              <CardContent>
                <AgingTable buckets={report.arAging} currency={currency} />
              </CardContent>
            </Card>
          </div>
          <div className="flex flex-col gap-4">
            <StatCard
              title="Accounts payable"
              value={money(kpis.accountsPayable)}
              hint="Unpaid bills you owe"
              icon={BanknoteArrowDownIcon}
            />
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
        </div>
      )}
    </>
  );
}
