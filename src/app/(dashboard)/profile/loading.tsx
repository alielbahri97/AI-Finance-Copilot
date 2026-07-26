import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-9 w-full max-w-lg" />
          <Skeleton className="h-9 w-full max-w-lg" />
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>
    </div>
  );
}
