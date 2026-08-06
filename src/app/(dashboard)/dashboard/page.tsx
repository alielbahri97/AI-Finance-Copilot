import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRightIcon,
  ChartSplineIcon,
  PiggyBankIcon,
  PlusIcon,
  ReceiptTextIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UploadIcon,
} from "lucide-react";

import { CashCard } from "@/components/dashboard/cash-card";
import { ChartsSection } from "@/components/dashboard/charts-section";
import { GettingStarted, hasNoFinancialData } from "@/components/dashboard/getting-started";
import { PersonalDashboard } from "@/components/dashboard/personal-dashboard";
import {
  BannerSkeleton,
  ChartRowSkeleton,
  StatRowSkeleton,
  TableCardSkeleton,
} from "@/components/dashboard/section-skeletons";
import { StatCard, StatRow } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
import { getEntitlements } from "@/lib/billing/entitlements";
import type { PlanLimits } from "@/lib/billing/plans";
import { editionBranding } from "@/lib/branding";
import { getDashboardData, getOrCreateProfile } from "@/lib/data";
import { buildForecast } from "@/lib/finance/data";
import { getInvoiceReminders } from "@/lib/invoices/reminders";
import { formatCurrency, localeForCurrency } from "@/lib/utils";
import { getWorkspaceContext } from "@/lib/workspace/context";
import { editionForWorkspaceType } from "@/lib/workspace/editions";
import { DashboardExportButton } from "@/components/exports/surface-export-buttons";

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
  const canEditTransactions = ctx.permissions.has("edit_transactions");
  const canExport = ctx.permissions.has("export_data");
  const edition = editionForWorkspaceType(workspace.type);

  const heading = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <PageHeading>{firstName ? `Welcome back, ${firstName}` : "Dashboard"}</PageHeading>
        <p className="text-muted-foreground text-sm">
          {edition === "personal"
            ? "Your money over the last six months — spending, budgets and what's coming up."
            : `Built for ${editionBranding("business").audience} — your overview for the last six months.`}
        </p>
      </div>
      <div className="flex gap-2">
        {canExport && <DashboardExportButton workspaceId={workspace.id} />}
        {canEditTransactions && (
          <>
            <Button asChild>
              <Link href="/transactions">
                <PlusIcon />
                Add transaction
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/import">
                <UploadIcon />
                Import
              </Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );

  if (edition === "personal") {
    // The plan decides which paid widgets exist, so it is resolved before the
    // sections stream rather than inside each one.
    const entitlements = await getEntitlements(workspace.id);
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <Suspense fallback={<StatRowSkeleton hero />}>
          <PersonalSection
            workspaceId={workspace.id}
            currency={workspace.currency}
            limits={entitlements.plan.limits}
            canViewTransactions={canViewTransactions}
            canViewReports={canViewReports}
            canEditTransactions={canEditTransactions}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {heading}

      {canViewTransactions && (
        <Suspense fallback={<StatRowSkeleton hero />}>
          <StatsSection
            workspaceId={workspace.id}
            currency={workspace.currency}
            canAddData={canEditTransactions}
          />
        </Suspense>
      )}

      {/* Reserves the banner's height: a null fallback pushed the forecast
          teaser and both chart rows down the moment this resolved. */}
      {canViewInvoices && (
        <Suspense fallback={<BannerSkeleton />}>
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
          <ChartsIfData workspaceId={workspace.id} currency={workspace.currency} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * Zero-state gate for the Personal edition. getDashboardData is
 * request-memoized, so asking here costs nothing the stats row was not going
 * to ask for anyway; everything inside PersonalDashboard still streams.
 */
async function PersonalSection({
  workspaceId,
  currency,
  limits,
  canViewTransactions,
  canViewReports,
  canEditTransactions,
}: {
  workspaceId: string;
  currency: string;
  limits: PlanLimits;
  canViewTransactions: boolean;
  canViewReports: boolean;
  canEditTransactions: boolean;
}) {
  const data = await getDashboardData(workspaceId);
  if (hasNoFinancialData(data)) {
    return <GettingStarted edition="personal" canAddData={canEditTransactions} />;
  }

  return (
    <PersonalDashboard
      workspaceId={workspaceId}
      currency={currency}
      limits={limits}
      canViewTransactions={canViewTransactions}
      canViewReports={canViewReports}
    />
  );
}

async function StatsSection({
  workspaceId,
  currency,
  canAddData,
}: {
  workspaceId: string;
  currency: string;
  canAddData: boolean;
}) {
  const data = await getDashboardData(workspaceId);
  // Four zeros and an empty pie chart read as a broken product, not an empty
  // one, and say nothing about what to do next.
  if (hasNoFinancialData(data)) {
    return <GettingStarted canAddData={canAddData} />;
  }

  const locale = localeForCurrency(currency);

  return (
    <StatRow>
      <CashCard cash={data.cash} emphasis="hero" />
      <StatCard
        title="Income this month"
        value={formatCurrency(data.monthIncome, currency, locale)}
        hint="vs. previous month"
        icon={TrendingUpIcon}
        changePct={data.incomeChangePct}
        increaseIsGood
      />
      <StatCard
        title="Expenses this month"
        value={formatCurrency(data.monthExpenses, currency, locale)}
        hint="vs. previous month"
        icon={TrendingDownIcon}
        changePct={data.expensesChangePct}
        increaseIsGood={false}
      />
      <StatCard
        title="Savings rate"
        value={`${data.savingsRate}%`}
        hint="Share of this month's income kept"
        icon={PiggyBankIcon}
      />
    </StatRow>
  );
}

/** The charts are replaced by the getting-started card, not stacked under it. */
async function ChartsIfData({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: string;
}) {
  const data = await getDashboardData(workspaceId);
  if (hasNoFinancialData(data)) return null;
  return <ChartsSection workspaceId={workspaceId} currency={currency} />;
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

  const locale = localeForCurrency(currency);

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
                `${invoiceReminders.overdue.length} overdue (${formatCurrency(invoiceReminders.overdueTotal, currency, locale)})`}
              {invoiceReminders.overdue.length > 0 && invoiceReminders.dueSoon.length > 0 && " · "}
              {invoiceReminders.dueSoon.length > 0 &&
                `${invoiceReminders.dueSoon.length} due this week (${formatCurrency(invoiceReminders.dueSoonTotal, currency, locale)})`}
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
  // An empty workspace projects a zero balance and infinite runway, which is
  // noise rather than a teaser.
  const data = await getDashboardData(workspaceId);
  if (hasNoFinancialData(data)) return null;

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
                {formatCurrency(
                  forecast.metrics.projectedBalance30d,
                  currency,
                  localeForCurrency(currency)
                )}
              </p>
            </div>
          </div>
          <ArrowRightIcon className="text-muted-foreground group-hover:text-primary ml-auto size-4 transition-colors" />
        </CardContent>
      </Card>
    </Link>
  );
}
