"use client";

import {
  formatRatioGuidance,
  type PersonalizedInsight,
  type RatioBenchmark,
  type RecommendationResult,
} from "@/lib/onboarding/benchmarks";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InfoIcon, TargetIcon } from "lucide-react";

function kindBadge(kind: RatioBenchmark["kind"]) {
  switch (kind) {
    case "ceiling":
      return "Keep in check";
    case "floor":
      return "Aim higher";
    default:
      return "Target band";
  }
}

export function RecommendationList({
  recommendations,
  className,
}: {
  recommendations: RecommendationResult;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Guidelines for {recommendations.businessTypeLabel}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{recommendations.disclaimer}</p>
      </div>

      <ul className="grid gap-3">
        {recommendations.ratios.map((ratio) => (
          <li
            key={ratio.id}
            className="border-border/60 flex flex-col gap-1 rounded-xl border p-4 shadow-xs sm:flex-row sm:items-start sm:justify-between sm:gap-4"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <TargetIcon className="text-muted-foreground size-4 shrink-0" />
                <span className="font-medium">{ratio.label}</span>
                <Badge variant="secondary">{kindBadge(ratio.kind)}</Badge>
              </div>
              <p className="text-muted-foreground text-sm">{ratio.description}</p>
            </div>
            <p className="text-sm font-medium whitespace-nowrap sm:text-right">
              {formatRatioGuidance(ratio)}
            </p>
          </li>
        ))}
      </ul>

      {recommendations.insights.length > 0 ? (
        <div className="grid gap-3">
          <h3 className="text-sm font-semibold tracking-tight">Based on your answers</h3>
          {recommendations.insights.map((insight) => (
            <InsightAlert key={insight.id} insight={insight} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InsightAlert({ insight }: { insight: PersonalizedInsight }) {
  return (
    <Alert variant={insight.outsideGuideline ? "destructive" : "default"}>
      <InfoIcon />
      <AlertTitle>{insight.label}</AlertTitle>
      <AlertDescription>{insight.message}</AlertDescription>
    </Alert>
  );
}
