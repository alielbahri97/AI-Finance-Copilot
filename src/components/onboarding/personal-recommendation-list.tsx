"use client";

import {
  type PersonalInsight,
  type PersonalRecommendationResult,
  type SuggestedGoal,
} from "@/lib/onboarding/personal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { InfoIcon, PiggyBankIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";

function goalQuery(goal: SuggestedGoal): string {
  const params = new URLSearchParams();
  params.set("suggest", goal.name);
  if (goal.targetAmount != null) params.set("amount", String(goal.targetAmount));
  if (goal.horizonMonths != null) {
    const date = new Date();
    date.setMonth(date.getMonth() + goal.horizonMonths);
    params.set("date", date.toISOString().slice(0, 10));
  }
  return `/goals?${params.toString()}`;
}

export function PersonalRecommendationList({
  recommendations,
  currency,
  className,
}: {
  recommendations: PersonalRecommendationResult;
  currency: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Suggestions for {recommendations.lifeStageLabel.toLowerCase()} ·{" "}
          {recommendations.primaryFocusLabel.toLowerCase()}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{recommendations.disclaimer}</p>
      </div>

      <ul className="grid gap-3">
        {recommendations.suggestedGoals.map((goal) => (
          <li
            key={goal.id}
            className="border-border flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <PiggyBankIcon className="text-muted-foreground size-4 shrink-0" />
                <span className="font-medium">{goal.name}</span>
                {goal.targetAmount != null ? (
                  <Badge variant="secondary">
                    ~{formatCurrency(goal.targetAmount, currency)}
                  </Badge>
                ) : null}
                {goal.horizonMonths != null ? (
                  <Badge variant="outline">~{goal.horizonMonths} mo</Badge>
                ) : (
                  <Badge variant="outline">No deadline</Badge>
                )}
              </div>
              <p className="text-muted-foreground text-sm">{goal.reason}</p>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href={goalQuery(goal)}>Add as goal</Link>
            </Button>
          </li>
        ))}
      </ul>

      {recommendations.insights.length > 0 ? (
        <div className="grid gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <SparklesIcon className="size-4" />
            Based on your answers
          </h3>
          {recommendations.insights.map((insight) => (
            <InsightAlert key={insight.id} insight={insight} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InsightAlert({ insight }: { insight: PersonalInsight }) {
  return (
    <Alert>
      <InfoIcon />
      <AlertTitle>{insight.label}</AlertTitle>
      <AlertDescription>
        {insight.message}
        {insight.href ? (
          <>
            {" "}
            <Link href={insight.href} className="underline underline-offset-2">
              Open
            </Link>
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
