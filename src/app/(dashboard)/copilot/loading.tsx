import { Skeleton } from "@/components/ui/skeleton";

export default function CopilotLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-[calc(100svh-11.5rem)] min-h-96 w-full rounded-xl" />
    </div>
  );
}
