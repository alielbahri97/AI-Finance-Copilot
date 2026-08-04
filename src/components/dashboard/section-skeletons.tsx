import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared Suspense fallbacks for streamed page sections. Shapes mirror the
 * real sections so streaming in data doesn't shift the layout.
 */

export function StatRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className={
        count === 3 ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      }
    >
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} className="gap-2">
          <CardHeader>
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ChartRowSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export function TableCardSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card>
      <CardContent className="space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export function BannerSkeleton() {
  return <Skeleton className="h-16 w-full rounded-xl" />;
}
