import type { ProgressTone } from "@/components/ui/progress";
import { RATE_WINDOW_MONTHS, type GoalStatus } from "@/lib/personal/goals";
import { formatCurrency, formatDate } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success";

/** Human wording for the status a goal is in. */
export const STATUS_LABELS: Record<GoalStatus, string> = {
  achieved: "Achieved",
  ahead: "On track",
  on_track: "Saving",
  behind: "Behind",
  stalled: "Stalled",
};

export const STATUS_TONES: Record<GoalStatus, ProgressTone> = {
  achieved: "success",
  ahead: "success",
  on_track: "default",
  behind: "warning",
  stalled: "destructive",
};

export const STATUS_BADGES: Record<GoalStatus, BadgeVariant> = {
  achieved: "success",
  ahead: "success",
  on_track: "secondary",
  behind: "outline",
  stalled: "outline",
};

/**
 * The subset of a projection the copy needs. Both the page's card data (dates
 * as ISO strings) and a `GoalProjection` straight from the summary (dates as
 * Date) satisfy it, so the page and the dashboard widget word things the same.
 */
export interface ProjectionLike {
  targetAmount: number;
  saved: number;
  remaining: number;
  monthlyRate: number;
  requiredMonthlyRate: number | null;
  monthsRemaining: number | null;
  projectedCompletion: Date | string | null;
  targetDate: Date | string | null;
  status: GoalStatus;
}

function months(count: number): string {
  return `${count} month${count === 1 ? "" : "s"}`;
}

/**
 * Explains the projection rather than just stating it: the rate it is based on,
 * the window that rate came from, where that lands, and what the target date
 * would actually demand. A user who disagrees with the date can see why it says
 * what it says.
 */
export function projectionSentences(goal: ProjectionLike, currency: string): string[] {
  const sentences: string[] = [];

  if (goal.status === "achieved") {
    sentences.push(
      `Fully funded: ${formatCurrency(goal.saved, currency)} set aside towards ${formatCurrency(goal.targetAmount, currency)}.`
    );
    if (goal.targetDate) {
      sentences.push(`Target date ${formatDate(goal.targetDate)}.`);
    }
    return sentences;
  }

  if (goal.monthlyRate <= 0 || !goal.projectedCompletion || goal.monthsRemaining === null) {
    sentences.push(
      `Nothing saved towards it in the last ${RATE_WINDOW_MONTHS} months, so there is no projected date yet. ${formatCurrency(goal.remaining, currency)} still to go.`
    );
  } else {
    sentences.push(
      `Reaches ${formatCurrency(goal.targetAmount, currency)} around ${formatDate(goal.projectedCompletion)}: ${months(goal.monthsRemaining)} to cover the remaining ${formatCurrency(goal.remaining, currency)}.`
    );
    sentences.push(
      `That is at ${formatCurrency(goal.monthlyRate, currency)} a month, your average over the last ${RATE_WINDOW_MONTHS} months, or since the goal started if it is newer.`
    );
  }

  if (goal.targetDate && goal.requiredMonthlyRate !== null) {
    const gap = goal.requiredMonthlyRate - goal.monthlyRate;
    const shortfall =
      gap > 0
        ? ` That is ${formatCurrency(gap, currency)} a month more than you are putting aside now.`
        : "";
    sentences.push(
      `To make ${formatDate(goal.targetDate)} you need ${formatCurrency(goal.requiredMonthlyRate, currency)} a month.${shortfall}`
    );
  }

  return sentences;
}
