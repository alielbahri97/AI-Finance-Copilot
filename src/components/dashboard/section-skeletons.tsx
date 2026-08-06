import { StatRow, statCardSpan } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared Suspense fallbacks for streamed page sections. Shapes mirror the
 * real sections so streaming in data doesn't shift the layout.
 */

/**
 * `hero` mirrors the dashboard stat rows, whose first card is double-width and
 * whose remaining figures are a step smaller than they would be on their own.
 */
export function StatRowSkeleton({ count = 4, hero = false }: { count?: number; hero?: boolean }) {
  const cards = Array.from({ length: count }).map((_, index) => {
    const isHero = hero && index === 0;
    return (
      <Card key={index} className={cn("gap-2", isHero && statCardSpan("hero"))}>
        <CardHeader>
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent className="space-y-2">
          {/* h-10 / h-7 / h-8 are the line boxes of text-4xl / text-xl / text-2xl. */}
          <Skeleton className={isHero ? "h-10 w-48" : hero ? "h-7 w-28" : "h-8 w-28"} />
          <Skeleton className="h-3 w-20" />
        </CardContent>
      </Card>
    );
  });

  if (hero) {
    return <StatRow>{cards}</StatRow>;
  }

  return (
    <div
      className={
        count === 3 ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      }
    >
      {cards}
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

/** Matches the height of the one-line teaser cards (py-4 around a size-10 icon). */
export function BannerSkeleton() {
  return <Skeleton className="h-[4.5rem] w-full rounded-xl" />;
}
