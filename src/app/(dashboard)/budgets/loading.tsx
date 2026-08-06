import { BudgetsBodySkeleton } from "@/components/budgets/budget-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Budgets looks the same in every workspace that can reach it (the route is
 * Personal-only), so this can mirror the whole page rather than stopping at a
 * shared subset the way the dashboard has to.
 */
export default function BudgetsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="h-5 w-36" />
          <Skeleton className="size-9 rounded-md" />
        </div>
      </div>
      <BudgetsBodySkeleton />
    </div>
  );
}
