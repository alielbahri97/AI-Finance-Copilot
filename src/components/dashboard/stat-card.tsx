import { TrendingDownIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone?: "default" | "positive" | "negative";
  /** Percent change vs the previous period; null hides the trend badge. */
  changePct?: number | null;
  /** Whether an increase is good (income) or bad (expenses). */
  increaseIsGood?: boolean;
}

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = "default",
  changePct,
  increaseIsGood = true,
}: StatCardProps) {
  const showTrend = changePct !== undefined && changePct !== null;
  const isGood = showTrend && (changePct >= 0 ? increaseIsGood : !increaseIsGood);

  return (
    <Card className="gap-2">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
        <Icon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className={cn(
              "text-2xl font-bold tracking-tight",
              tone === "positive" && "text-success",
              tone === "negative" && "text-destructive"
            )}
          >
            {value}
          </span>
          {showTrend && (
            <span
              className={cn(
                "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
                isGood ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"
              )}
            >
              {changePct >= 0 ? (
                <TrendingUpIcon className="size-3" />
              ) : (
                <TrendingDownIcon className="size-3" />
              )}
              {changePct > 0 ? "+" : ""}
              {changePct}%
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}
