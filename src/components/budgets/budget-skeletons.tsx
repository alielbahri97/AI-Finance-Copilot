import { StatRowSkeleton } from "@/components/dashboard/section-skeletons";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Everything below the page header, shared by `loading.tsx` and the page's own
 * Suspense boundary so the two can't drift apart. Gaps match the real page
 * (`gap-6` between sections, `gap-1` between category rows) so the layout does
 * not move when the month's data streams in.
 */
export function BudgetsBodySkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <>
      <StatRowSkeleton hero />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* The add-a-budget bar: a bordered row of two fields, a switch and a button. */}
          <Skeleton className="h-[5.75rem] w-full rounded-lg" />
          <div className="flex flex-col gap-1">
            {Array.from({ length: rows }).map((_, index) => (
              <div key={index} className="flex flex-col gap-2 px-2 py-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-3 w-56" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
