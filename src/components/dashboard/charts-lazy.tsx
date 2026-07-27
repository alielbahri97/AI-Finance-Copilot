"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lazy-loaded chart bundle: keeps Recharts (~100 kB) out of the initial
 * dashboard JS and out of server rendering. The skeletons match the chart
 * container heights to avoid layout shift.
 */

const chartFallback = (height: string) =>
  function ChartFallback() {
    return <Skeleton className={height} />;
  };

export const OverviewChart = dynamic(
  () => import("./overview-chart").then((m) => m.OverviewChart),
  { ssr: false, loading: chartFallback("h-[300px] w-full") }
);

export const CategoryChart = dynamic(
  () => import("./category-chart").then((m) => m.CategoryChart),
  { ssr: false, loading: chartFallback("h-[300px] w-full") }
);

export const BalanceChart = dynamic(
  () => import("./balance-chart").then((m) => m.BalanceChart),
  { ssr: false, loading: chartFallback("h-[300px] w-full") }
);
