import { TrendingDownIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A stat row should have one answer, not four competing ones. `emphasis="hero"`
 * is the edition's headline figure — it spans two grid columns and reads at
 * twice the size; everything else in the row is deliberately quieter.
 */
export type StatEmphasis = "default" | "hero";

/**
 * The grid a hero stat row lives in: five columns at xl so the hero can take
 * two of them and the three supporting cards still fit on one line.
 */
export const STAT_ROW_GRID = "grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-5";

/**
 * Soft chrome so money figures lead. Hero cards drop the border weight further
 * and pick up a touch more padding for the oversized figure.
 */
export const statCardChrome = (emphasis: StatEmphasis) =>
  emphasis === "hero"
    ? "gap-3 border-border/50 py-5 shadow-xs"
    : "gap-2 border-border/60 shadow-xs";

/**
 * A stat row containing a hero. The `data-hero` marker is what quiets the
 * other cards in the row (see `statValueClass`), and it lives on the row
 * rather than on each card because a card cannot know what it is standing
 * next to — which is how Invoices, Subscriptions and Admin ended up with
 * deferential figures and nothing to defer to.
 */
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div data-hero className={cn("group/stat-row", STAT_ROW_GRID)}>
      {children}
    </div>
  );
}

/**
 * Grid span for the card itself, shared with CashCard and the skeleton row.
 * Only widened at xl: below that the row is two columns, where a full-width
 * hero would leave the fourth card stranded alone on a third line. At those
 * sizes the type scale alone carries the hierarchy.
 */
export const statCardSpan = (emphasis: StatEmphasis) =>
  emphasis === "hero" ? "xl:col-span-2" : undefined;

/**
 * Type scale for the figure, shared with CashCard. Emphasis is relative: a
 * card is only quiet in relation to a louder one, so the smaller figure is
 * scoped to rows that actually have a hero. A row without one keeps the full
 * size, because there is nothing there for it to be quieter than.
 */
export const statValueClass = (emphasis: StatEmphasis) =>
  emphasis === "hero"
    ? "text-4xl font-bold tracking-tight sm:text-5xl"
    : "text-2xl font-semibold tracking-tight group-data-hero/stat-row:text-lg group-data-hero/stat-row:font-semibold sm:group-data-hero/stat-row:text-xl";

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
  emphasis?: StatEmphasis;
}

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = "default",
  changePct,
  increaseIsGood = true,
  emphasis = "default",
}: StatCardProps) {
  const showTrend = changePct !== undefined && changePct !== null;
  const isGood = showTrend && (changePct >= 0 ? increaseIsGood : !increaseIsGood);

  return (
    <Card className={cn(statCardChrome(emphasis), statCardSpan(emphasis))}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
        <Icon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className={cn(
              "numeric",
              statValueClass(emphasis),
              tone === "positive" && "text-success",
              tone === "negative" && "text-destructive"
            )}
          >
            {value}
          </span>
          {showTrend && (
            <span
              className={cn(
                "numeric flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
                isGood ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
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
        <p className="text-muted-foreground mt-1.5 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}
