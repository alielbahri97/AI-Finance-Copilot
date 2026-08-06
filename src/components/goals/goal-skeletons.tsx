import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors GoalsSummaryCard: one big figure, a bar, then three small stats. */
function GoalsSummarySkeleton() {
  return (
    <Card className="gap-4">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Mirrors GoalCard: title row, progress block, projection copy, four stats. */
function GoalCardSkeleton() {
  return (
    <Card className="gap-3">
      <CardHeader>
        <Skeleton className="h-5 w-44" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-10" />
          </div>
          <Skeleton className="h-2 w-full" />
        </div>
        <div className="space-y-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Everything below the page header, shared by `loading.tsx` and the page's own
 * Suspense boundary so the two can't drift apart. Gaps match the real page
 * (`space-y-6` between sections, `space-y-4` inside the manager, `gap-4`
 * between cards) so nothing shifts when the goals stream in.
 *
 * Assumes the funded path: a workspace whose plan excludes goals gets an
 * upgrade notice instead, and one with no goals yet gets an empty state. Both
 * are decided by data this fallback cannot see, and both are rarer than a
 * workspace that simply has goals.
 */
export function GoalsBodySkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <>
      <GoalsSummarySkeleton />
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: cards }).map((_, index) => (
            <GoalCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </>
  );
}
