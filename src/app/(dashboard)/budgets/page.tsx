import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PiggyBankIcon,
  TrendingDownIcon,
  WalletIcon,
} from "lucide-react";

import { BudgetManager } from "@/components/budgets/budget-manager";
import { BudgetsBodySkeleton } from "@/components/budgets/budget-skeletons";
import { StatCard, StatRow } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page-heading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  monthLabel,
  nextMonth,
  parsePeriod,
  periodOf,
  previousMonth,
  type BudgetPeriod,
} from "@/lib/personal/budgets";
import { getBudgetOverview } from "@/lib/personal/budgets-data";
import { formatCurrency, localeForCurrency } from "@/lib/utils";
import { getWorkspaceContext } from "@/lib/workspace/context";
import { editionHasFeature } from "@/lib/workspace/editions";

export const metadata: Metadata = { title: "Budgets" };
export const dynamic = "force-dynamic";

interface BudgetsPageProps {
  searchParams: Promise<{ year?: string; month?: string }>;
}

function periodHref(period: BudgetPeriod): string {
  return `/budgets?year=${period.year}&month=${period.month}`;
}

export default async function BudgetsPage({ searchParams }: BudgetsPageProps) {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  // The nav hides the link in a Business workspace; this is what actually
  // stops a typed-in URL from reaching the page.
  if (!editionHasFeature(ctx.workspace.type, "budgets")) notFound();
  if (!ctx.permissions.has("view_reports")) redirect("/dashboard");

  const params = await searchParams;
  const thisMonth = periodOf(new Date());
  const period = parsePeriod(params.year, params.month, thisMonth);
  const isThisMonth = period.year === thisMonth.year && period.month === thisMonth.month;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <PageHeading>Budgets</PageHeading>
          <p className="text-muted-foreground text-sm">
            How {monthLabel(period)} is tracking against your limits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" asChild>
            <Link href={periodHref(previousMonth(period))} aria-label="Previous month">
              <ChevronLeftIcon />
            </Link>
          </Button>
          <span className="min-w-36 text-center text-sm font-medium">{monthLabel(period)}</span>
          <Button variant="outline" size="icon" asChild>
            <Link href={periodHref(nextMonth(period))} aria-label="Next month">
              <ChevronRightIcon />
            </Link>
          </Button>
          {!isThisMonth && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/budgets">This month</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Keyed on the period so stepping to another month shows the skeleton
          again rather than holding the previous month on screen. */}
      <Suspense key={`${period.year}-${period.month}`} fallback={<BudgetsBodySkeleton />}>
        <BudgetsBody
          workspaceId={ctx.workspace.id}
          currency={ctx.workspace.currency}
          period={period}
          canEdit={ctx.permissions.has("edit_transactions")}
        />
      </Suspense>
    </div>
  );
}

interface BudgetsBodyProps {
  workspaceId: string;
  currency: string;
  period: BudgetPeriod;
  canEdit: boolean;
}

async function BudgetsBody({ workspaceId, currency, period, canEdit }: BudgetsBodyProps) {
  const { summary, categories } = await getBudgetOverview(workspaceId, period);
  const locale = localeForCurrency(currency);
  const money = (value: number) => formatCurrency(value, currency, locale);

  return (
    <>
      <StatRow>
        <StatCard
          title="Remaining"
          value={money(summary.totalRemaining)}
          hint={summary.totalRemaining < 0 ? "Spending is past the total" : "Left to spend this month"}
          icon={PiggyBankIcon}
          tone={summary.totalRemaining < 0 ? "negative" : "positive"}
          emphasis="hero"
        />
        <StatCard
          title="Budgeted"
          value={money(summary.totalAvailable)}
          hint={
            summary.totalAvailable === summary.totalLimit
              ? "Across every category with a limit"
              : `Limits of ${money(summary.totalLimit)} plus rollover`
          }
          icon={WalletIcon}
        />
        <StatCard
          title="Spent"
          value={money(summary.totalSpent)}
          hint="Expenses in budgeted categories"
          icon={TrendingDownIcon}
        />
        <StatCard
          title="Over budget"
          value={String(summary.overCount)}
          hint={summary.overCount === 1 ? "Category past its limit" : "Categories past their limit"}
          icon={AlertTriangleIcon}
          tone={summary.overCount > 0 ? "negative" : "default"}
        />
      </StatRow>

      <Card>
        <CardHeader>
          <CardTitle>{monthLabel(period)}</CardTitle>
          <CardDescription>
            Underspend rolls forward; overspend comes out of next month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetManager
            summary={summary}
            categories={categories}
            currency={currency}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </>
  );
}
