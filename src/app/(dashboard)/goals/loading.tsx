import { GoalsBodySkeleton } from "@/components/goals/goal-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function GoalsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <GoalsBodySkeleton />
    </div>
  );
}
