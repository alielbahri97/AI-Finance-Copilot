import Link from "next/link";
import { ArrowRightIcon, WalletIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyText } from "@/components/ui/money-text";
import { Progress } from "@/components/ui/progress";
import { budgetStatus, monthLabel, type BudgetSummary } from "@/lib/personal/budgets";
import { formatCurrency, localeForCurrency } from "@/lib/utils";

import { STATUS_TONES } from "./status-tone";

/** How many category bars fit before the card stops being a summary. */
const VISIBLE_CATEGORIES = 4;

interface BudgetWidgetProps {
  summary: BudgetSummary;
  currency: string;
}

/**
 * Dashboard view of the month's budgets: one bar for the whole month, then the
 * categories that most need attention. Takes plain data so the dashboard can
 * render it without knowing where budgets come from.
 */
export function BudgetWidget({ summary, currency }: BudgetWidgetProps) {
  const period = { year: summary.year, month: summary.month };
  const overall = budgetStatus(summary.totalSpent, summary.totalAvailable);
  const locale = localeForCurrency(currency);
  const money = (value: number) => formatCurrency(value, currency, locale);

  // Over-budget categories first; within each group the summary is already
  // ordered by spend, which is the order that reads as "biggest first".
  const categories = [...summary.budgets]
    .sort((a, b) => Number(b.status === "over") - Number(a.status === "over"))
    .slice(0, VISIBLE_CATEGORIES);

  return (
    <Card className="gap-3">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Budgets</CardTitle>
          <CardDescription>{monthLabel(period)}</CardDescription>
        </div>
        <WalletIcon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {summary.budgets.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={WalletIcon}
            title="No budgets this month"
            description="Set a limit on a category or two and this card shows how much is left."
            action={
              <Button size="sm" asChild>
                <Link href="/budgets">Set a monthly limit</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <MoneyText
                  amount={summary.totalSpent}
                  currency={currency}
                  locale={locale}
                  size="lg"
                />
                <span className="text-muted-foreground text-sm">
                  of {money(summary.totalAvailable)} budgeted
                </span>
              </div>
              <Progress
                value={summary.ratio * 100}
                tone={STATUS_TONES[overall]}
                label="Total budget used"
              />
              <p className="text-muted-foreground text-xs">
                {summary.totalRemaining < 0
                  ? `${money(Math.abs(summary.totalRemaining))} over across all budgets`
                  : `${money(summary.totalRemaining)} left this month`}
                {summary.overCount > 0 &&
                  ` · ${summary.overCount} ${summary.overCount === 1 ? "category is" : "categories are"} over`}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {categories.map((budget) => (
                <div key={budget.id} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate font-medium">{budget.category}</span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {money(budget.spent)} / {money(budget.available)}
                    </span>
                  </div>
                  <Progress
                    value={budget.ratio * 100}
                    tone={STATUS_TONES[budget.status]}
                    label={`${budget.category} budget used`}
                  />
                </div>
              ))}
            </div>

            <Link
              href="/budgets"
              className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-xs transition-colors"
            >
              All budgets
              <ArrowRightIcon className="size-3" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
