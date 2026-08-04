import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRightIcon,
  ChartSplineIcon,
  PiggyBankIcon,
  ReceiptTextIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";

import { CashCard } from "@/components/dashboard/cash-card";
import { ChartsSection } from "@/components/dashboard/charts-section";
import { PersonalDashboard } from "@/components/dashboard/personal-dashboard";
import {
  BannerSkeleton,
  ChartRowSkeleton,
  StatRowSkeleton,
  TableCardSkeleton,
} from "@/components/dashboard/section-skeletons";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { getEntitlements } from "@/lib/billing/entitlements";
import { editionBranding } from "@/lib/branding";
import { getDashboardData, getOrCreateProfile } from "@/lib/data";
import { buildForecast } from "@/lib/finance/data";
import { getInvoiceReminders } from "@/lib/invoices/reminders";
import { formatCurrency } from "@/lib/utils";
import { getWorkspaceContext } from "@/lib/workspace/context";
import { editionForWorkspaceType } from "@/lib/workspace/editions";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * The page streams: the header renders immediately, while each data section
 * (stats, invoice alert, forecast teaser, charts) resolves independently
 * behind its own Suspense boundary. getDashboardData is request-memoized so
 * the stats and charts sections share one query set.
 */
export default async function DashboardPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  const { workspace } = ctx;

  const profile = await getOrCreateProfile(ctx.user);
  const firstName = profile.fullName?.split(" ")[0];
  const canViewTransactions = ctx.permissions.has("view_transactions");
  const canViewInvoices = ctx.permissions.has("view_invoices");
  const canViewReports = ctx.permissions.has("view_reports");
  const edition = editionForWorkspaceType(workspace.type);

  const heading = (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {firstName ? `Welcome back, ${firstName}` : "Dashboard"}
      </h1>
      <p className="text-muted-foreground text-sm">
        {edition === "personal"
          ? "Your money over the last six months — spending, budgets and what's coming up."
          : `Built for ${editionBranding("business").audience} — your overview for the last six months.`}
      </p>
    </div>
  );

  if (edition === "personal") {
    // The plan decides which paid widgets exist, so it is resolved before the
    // sections stream rather than inside each one.
    const entitlements = await getEntitlements(workspace.id);
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <PersonalDashboard
          workspaceId={workspace.id}
          currency={workspace.currency}
          limits={entitlements.plan.limits}
          canViewTransactions={canViewTransactions}
          canViewReports={canViewReports}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {heading}

      {canViewTransactions && (
        <Suspense fallback={<StatRowSkeleton />}>
          <StatsSection workspaceId={workspace.id} currency={workspace.currency} />
        </Suspense>
      )}

      {canViewInvoices && (
        <Suspense fallback={null}>
          <InvoiceAlertSection workspaceId={workspace.id} currency={workspace.currency} />
        </Suspense>
      )}

      {canViewReports && (
        <Suspense fallback={<BannerSkeleton />}>
          <ForecastTeaserSection workspaceId={workspace.id} currency={workspace.currency} />
        </Suspense>
      )}

      {canViewTransactions && (
        <Suspense
          fallback={
            <>
              <ChartRowSkeleton />
              <ChartRowSkeleton />
              <TableCardSkeleton rows={6} />
            </>
          }
        >
          <ChartsSection workspaceId={workspace.id} currency={workspace.currency} />
        </Suspense>
      )}
    </div>
  );
}

async function StatsSection({ workspaceId, currency }: { workspaceId: string; currency: string }) {
  const data = await getDashboardData(workspaceId);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title="Income this month"
        value={formatCurrency(data.monthIncome, currency)}
        hint="vs. previous month"
        icon={TrendingUpIcon}
        changePct={data.incomeChangePct}
        increaseIsGood
      />
      <StatCard
        title="Expenses this month"
        value={formatCurrency(data.monthExpenses, currency)}
        hint="vs. previous month"
        icon={TrendingDownIcon}
        changePct={data.expensesChangePct}
        increaseIsGood={false}
      />
      <CashCard cash={data.cash} />
      <StatCard
        title="Savings rate"
        value={`${data.savingsRate}%`}
        hint="Share of this month's income kept"
        icon={PiggyBankIcon}
      />
    </div>
  );
}

async function InvoiceAlertSection({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: string;
}) {
  const invoiceReminders = await getInvoiceReminders(workspaceId);
  const dueCount = invoiceReminders.dueSoon.length + invoiceReminders.overdue.length;
  if (dueCount === 0) return null;

  return (
    <Link href="/invoices" className="group">
      <Card className="hover:border-destructive/40 gap-2 py-4 transition-colors">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="bg-destructive/10 text-destructive flex size-10 shrink-0 items-center justify-center rounded-lg">
            <ReceiptTextIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {dueCount === 1 ? "1 invoice needs attention" : `${dueCount} invoices need attention`}
            </p>
            <p className="text-muted-foreground text-xs">
              {invoiceReminders.overdue.length > 0 &&
                `${invoiceReminders.overdue.length} overdue (${formatCurrency(invoiceReminders.overdueTotal, currency)})`}
              {invoiceReminders.overdue.length > 0 && invoiceReminders.dueSoon.length > 0 && " · "}
              {invoiceReminders.dueSoon.length > 0 &&
                `${invoiceReminders.dueSoon.length} due this week (${formatCurrency(invoiceReminders.dueSoonTotal, currency)})`}
            </p>
          </div>
          <ArrowRightIcon className="text-muted-foreground group-hover:text-destructive ml-auto size-4 transition-colors" />
        </CardContent>
      </Card>
    </Link>
  );
}

async function ForecastTeaserSection({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: string;
}) {
  const forecast = await buildForecast(workspaceId, currency);
  const runwayLabel =
    forecast.metrics.runwayMonths === null
      ? "∞ (cash-flow positive)"
      : `~${Math.round(forecast.metrics.runwayMonths * 10) / 10} months`;

  return (
    <Link href="/forecast" className="group">
      <Card className="hover:border-primary/40 gap-2 py-4 transition-colors">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
            <ChartSplineIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Cash flow forecast</p>
            <p className="text-muted-foreground text-xs">
              Runway, projections and what-if assumptions
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <p className="text-muted-foreground text-xs">Cash runway</p>
              <p className="text-sm font-semibold">{runwayLabel}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Projected balance in 30 days</p>
              <p className="text-sm font-semibold">
                {formatCurrency(forecast.metrics.projectedBalance30d, currency)}
              </p>
            </div>
          </div>
          <ArrowRightIcon className="text-muted-foreground group-hover:text-primary ml-auto size-4 transition-colors" />
        </CardContent>
      </Card>
    </Link>
  );
}
