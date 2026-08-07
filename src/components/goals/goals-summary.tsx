import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/ui/money-text";
import { Progress } from "@/components/ui/progress";
import type { GoalsSummary } from "@/lib/personal/goals";
import { localeForCurrency } from "@/lib/utils";

interface GoalsSummaryCardProps {
  summary: GoalsSummary;
  currency: string;
}

/** The combined picture across every active goal. Server-rendered. */
export function GoalsSummaryCard({ summary, currency }: GoalsSummaryCardProps) {
  const { goals, behindCount, achievedCount } = summary;
  const withDates = goals.filter((goal) => goal.requiredMonthlyRate !== null).length;
  const locale = localeForCurrency(currency);

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>All goals together</CardTitle>
        <CardDescription>
          {goals.length} goal{goals.length === 1 ? "" : "s"}
          {achievedCount > 0 ? `, ${achievedCount} achieved` : ""}
          {behindCount > 0
            ? `, ${behindCount} behind ${behindCount === 1 ? "its" : "their"} target date`
            : ""}
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <MoneyText
              amount={summary.totalSaved}
              currency={currency}
              locale={locale}
              size="hero"
            />
            <span className="text-muted-foreground text-sm">
              of{" "}
              <MoneyText
                amount={summary.totalTarget}
                currency={currency}
                locale={locale}
                size="sm"
                tone="muted"
                className="inline font-medium"
              />
            </span>
          </div>
          <Progress
            value={summary.progress * 100}
            tone={behindCount > 0 ? "warning" : "success"}
            label="Combined savings-goal progress"
          />
          <p className="text-muted-foreground text-xs">
            {Math.round(summary.progress * 100)}% of everything you are saving for.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">Still to save</dt>
            <dd>
              <MoneyText
                amount={Math.max(0, summary.totalTarget - summary.totalSaved)}
                currency={currency}
                locale={locale}
                size="md"
              />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Needed per month</dt>
            <dd>
              <MoneyText
                amount={summary.requiredMonthlyTotal}
                currency={currency}
                locale={locale}
                size="md"
              />
            </dd>
            <p className="text-muted-foreground text-xs">
              {withDates === 0
                ? "No goal has a target date yet"
                : `To hit ${withDates === 1 ? "the one goal" : `all ${withDates} goals`} with a target date`}
            </p>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Behind</dt>
            <dd className="text-base font-semibold tracking-tight tabular-nums">{behindCount}</dd>
            <p className="text-muted-foreground text-xs">
              {behindCount === 0 ? "Every dated goal is on track" : "Projected to miss the date"}
            </p>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
