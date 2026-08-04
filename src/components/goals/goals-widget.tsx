import Link from "next/link";
import { PiggyBankIcon } from "lucide-react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { selectFocusGoals, type GoalsSummary } from "@/lib/personal/goals";
import { formatCurrency } from "@/lib/utils";

import { projectionSentences, STATUS_LABELS, STATUS_TONES } from "./status";

interface GoalsWidgetProps {
  summary: GoalsSummary;
  currency: string;
}

/**
 * Dashboard card: combined goal progress, then the two or three goals that need
 * a decision. Server-rendered from plain props, so it can be dropped onto the
 * personal dashboard without a client bundle.
 */
export function GoalsWidget({ summary, currency }: GoalsWidgetProps) {
  const focus = selectFocusGoals(summary.goals, 3);

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
          <PiggyBankIcon className="size-4" />
          Savings goals
        </CardTitle>
        <CardAction>
          <Link href="/goals" className="text-muted-foreground hover:text-foreground text-xs">
            View all
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {focus.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No goals yet.{" "}
            <Link href="/goals" className="underline underline-offset-4">
              Set one up
            </Link>{" "}
            to track what you are saving for.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xl font-bold tracking-tight tabular-nums">
                  {formatCurrency(summary.totalSaved, currency)}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  of {formatCurrency(summary.totalTarget, currency)}
                </span>
              </div>
              <Progress
                value={summary.progress * 100}
                tone={summary.behindCount > 0 ? "warning" : "success"}
                label="Combined savings-goal progress"
              />
              <p className="text-muted-foreground text-xs">
                {formatCurrency(summary.requiredMonthlyTotal, currency)} a month keeps every
                dated goal on time.
              </p>
            </div>

            <ul className="space-y-3">
              {focus.map((goal) => (
                <li key={goal.id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{goal.name}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {STATUS_LABELS[goal.status]}
                    </span>
                  </div>
                  <Progress
                    value={goal.progress * 100}
                    tone={STATUS_TONES[goal.status]}
                    label={`${goal.name} progress`}
                  />
                  <p className="text-muted-foreground text-xs">
                    {projectionSentences(goal, currency)[0]}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
