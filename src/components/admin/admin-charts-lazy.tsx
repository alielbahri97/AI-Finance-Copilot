"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/** Lazy Recharts bundle for the admin page (see dashboard/charts-lazy). */

const chartFallback = (height: string) =>
  function ChartFallback() {
    return <Skeleton className={height} />;
  };

export const SignupsChart = dynamic(
  () => import("./admin-charts").then((m) => m.SignupsChart),
  { ssr: false, loading: chartFallback("h-[260px] w-full") }
);

export const EventsChart = dynamic(() => import("./admin-charts").then((m) => m.EventsChart), {
  ssr: false,
  loading: chartFallback("h-[260px] w-full"),
});
