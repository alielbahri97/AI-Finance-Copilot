import {
  ChartRowSkeleton,
  StatRowSkeleton,
} from "@/components/dashboard/section-skeletons";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The two donut cards, whose bodies are a fixed h-64 in both editions. */
function CategoryPairSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 2 }).map((_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Everything below the page header, shared by `loading.tsx` and the page's own
 * Suspense boundary so the two can't drift apart.
 *
 * Stops at the sections both editions render — the hero KPI row, the two
 * trend charts, the two category donuts. Below that a Business workspace adds
 * counterparty tables and AR/AP aging that a Personal one never receives, and
 * the edition isn't known until the workspace resolves, so promising them here
 * would show skeletons for content that never arrives.
 */
export function ReportBodySkeleton() {
  return (
    <>
      <StatRowSkeleton hero />
      <ChartRowSkeleton />
      <CategoryPairSkeleton />
    </>
  );
}
