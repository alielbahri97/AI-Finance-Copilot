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
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
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
import { formatCurrency } from "@/lib/utils";
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

  const { summary, categories } = await getBudgetOverview(ctx.workspace.id, period);
  const currency = ctx.workspace.currency;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Budgets</h1>
          <p className="text-muted-foreground text-sm">
            A monthly limit per category, and how {monthLabel(period)} is tracking against it.
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Budgeted"
          value={formatCurrency(summary.totalAvailable, currency)}
          hint={
            summary.totalAvailable === summary.totalLimit
              ? "Across every category with a limit"
              : `Limits of ${formatCurrency(summary.totalLimit, currency)} plus rollover`
          }
          icon={WalletIcon}
        />
        <StatCard
          title="Spent"
          value={formatCurrency(summary.totalSpent, currency)}
          hint="Expenses in budgeted categories"
          icon={TrendingDownIcon}
        />
        <StatCard
          title="Remaining"
          value={formatCurrency(summary.totalRemaining, currency)}
          hint={summary.totalRemaining < 0 ? "Spending is past the total" : "Left to spend"}
          icon={PiggyBankIcon}
          tone={summary.totalRemaining < 0 ? "negative" : "positive"}
        />
        <StatCard
          title="Over budget"
          value={String(summary.overCount)}
          hint={summary.overCount === 1 ? "Category past its limit" : "Categories past their limit"}
          icon={AlertTriangleIcon}
          tone={summary.overCount > 0 ? "negative" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{monthLabel(period)}</CardTitle>
          <CardDescription>
            Rollover carries an underspend into the next month and takes an overspend out of it, so
            a category settles over time instead of resetting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetManager
            summary={summary}
            categories={categories}
            currency={currency}
            canEdit={ctx.permissions.has("edit_transactions")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
