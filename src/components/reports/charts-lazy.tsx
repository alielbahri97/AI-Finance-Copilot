"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/** Lazy Recharts bundle for the reports page (see dashboard/charts-lazy). */

const chartFallback = (height: string) =>
  function ChartFallback() {
    return <Skeleton className={height} />;
  };

export const MonthlyTrendChart = dynamic(
  () => import("./monthly-trend-chart").then((m) => m.MonthlyTrendChart),
  { ssr: false, loading: chartFallback("h-[320px] w-full") }
);

export const YearlyChart = dynamic(() => import("./yearly-chart").then((m) => m.YearlyChart), {
  ssr: false,
  loading: chartFallback("h-[320px] w-full"),
});

export const CategoryBreakdown = dynamic(
  () => import("./category-breakdown").then((m) => m.CategoryBreakdown),
  { ssr: false, loading: chartFallback("h-[280px] w-full") }
);
