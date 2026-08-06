import { BannerSkeleton, StatRowSkeleton } from "@/components/dashboard/section-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The edition isn't known until the workspace resolves, and the two dashboards
 * diverge below the stat row (business goes straight to charts, personal shows
 * budgets, bills, goals and subscriptions first). So this stops at the parts
 * both editions actually share — heading, stat row, one banner — rather than
 * promising a layout half the users will never see.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <StatRowSkeleton hero />
      <BannerSkeleton />
    </div>
  );
}
