"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/** Lazy Recharts bundle for the scenario comparison (see forecast-chart-lazy). */
export const ScenarioComparisonChart = dynamic(
  () => import("./scenario-comparison-chart").then((m) => m.ScenarioComparisonChart),
  {
    ssr: false,
    loading: function ChartFallback() {
      return <Skeleton className="h-[380px] w-full" />;
    },
  }
);
