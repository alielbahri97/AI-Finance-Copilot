import { Skeleton } from "@/components/ui/skeleton";

export default function CopilotLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid min-h-[420px] flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Skeleton className="hidden h-full rounded-xl lg:block" />
        <Skeleton className="h-full rounded-xl" />
      </div>
    </div>
  );
}
