"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/** Lazy Recharts bundle for the forecast page (see dashboard/charts-lazy). */
export const ForecastChart = dynamic(
  () => import("./forecast-chart").then((m) => m.ForecastChart),
  {
    ssr: false,
    loading: function ChartFallback() {
      return <Skeleton className="h-[380px] w-full" />;
    },
  }
);
