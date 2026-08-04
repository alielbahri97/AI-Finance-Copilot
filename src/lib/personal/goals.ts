/**
 * Savings-goal arithmetic — pure logic, no database, no Prisma types.
 *
 * A goal is a target amount, optionally by a target date. Progress is what has
 * been put aside; the projection answers "when will I get there at the rate I
 * am actually saving", which is the number that makes a goal useful rather
 * than decorative.
 */

/** How many months of contributions the saving rate is averaged over. */
export const RATE_WINDOW_MONTHS = 6;

export interface GoalContribution {
  amount: number;
  date: Date;
}

export interface GoalRow {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: Date | null;
  /** Money already set aside when the goal was created. */
  startingAmount: number;
  createdAt: Date;
  achievedAt: Date | null;
}

export type GoalStatus =
  /** Fully funded. */
  | "achieved"
  /** No deadline, and saving at a rate that will get there. */
  | "on_track"
  /** Has a deadline and the projection lands on or before it. */
  | "ahead"
  /** Has a deadline and the projection lands after it. */
  | "behind"
  /** Nothing is being saved towards it, so there is no projection at all. */
  | "stalled";

export interface GoalProjection {
  id: string;
  name: string;
  targetAmount: number;
  /** Starting amount plus every contribution. */
  saved: number;
  /** Left to save; 0 once the target is reached. */
  remaining: number;
  /** `saved / targetAmount`, clamped to 0–1 for the progress bar. */
  progress: number;
  /** Average saved per month over the rate window. */
  monthlyRate: number;
  /** What the deadline demands per month from now. Null without a deadline. */
  requiredMonthlyRate: number | null;
  /** Whole months to go at `monthlyRate`. Null when nothing is being saved. */
  monthsRemaining: number | null;
  /** When the current rate gets there. Null when nothing is being saved. */
  projectedCompletion: Date | null;
  targetDate: Date | null;
  status: GoalStatus;
  contributionCount: number;
  lastContributionAt: Date | null;
}

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  );
}

/** Same day-of-month `months` later, clamped to the end of a shorter month. */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, lastDayOfTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    )
  );
}

/**
 * Average monthly saving, over the most recent `RATE_WINDOW_MONTHS`.
 *
 * The divisor is how many months the goal has actually been running (capped at
 * the window, floored at 1), not how many had a contribution — otherwise a
 * goal funded once six months ago would report that single deposit as its
 * monthly rate and project a completion it has no chance of hitting.
 */
export function savingRate(
  contributions: readonly GoalContribution[],
  goalStart: Date,
  now: Date
): number {
  if (contributions.length === 0) return 0;

  const windowStart = addMonths(now, -(RATE_WINDOW_MONTHS - 1));
  const start = goalStart > windowStart ? goalStart : windowStart;
  const inWindow = contributions.filter((c) => c.date >= start && c.date <= now);
  if (inWindow.length === 0) return 0;

  // Inclusive month count: a goal created this month has been running 1 month.
  const monthsCovered = Math.min(
    RATE_WINDOW_MONTHS,
    Math.max(1, monthsBetween(start, now) + 1)
  );
  const total = inWindow.reduce((sum, c) => sum + c.amount, 0);
  return total / monthsCovered;
}

export function projectGoal(
  goal: GoalRow,
  contributions: readonly GoalContribution[],
  now = new Date()
): GoalProjection {
  const contributed = contributions.reduce((sum, c) => sum + c.amount, 0);
  const saved = goal.startingAmount + contributed;
  const remaining = Math.max(0, goal.targetAmount - saved);
  const progress =
    goal.targetAmount > 0 ? Math.min(1, Math.max(0, saved / goal.targetAmount)) : 0;

  const monthlyRate = savingRate(contributions, goal.createdAt, now);
  const achieved = Boolean(goal.achievedAt) || remaining === 0;

  const monthsRemaining =
    achieved || monthlyRate <= 0 ? null : Math.ceil(remaining / monthlyRate);
  const projectedCompletion =
    monthsRemaining === null ? null : addMonths(now, monthsRemaining);

  let requiredMonthlyRate: number | null = null;
  if (goal.targetDate && !achieved) {
    // A deadline this month or already past still needs the full remainder.
    const monthsLeft = Math.max(1, monthsBetween(now, goal.targetDate));
    requiredMonthlyRate = remaining / monthsLeft;
  }

  const sorted = [...contributions].sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    id: goal.id,
    name: goal.name,
    targetAmount: goal.targetAmount,
    saved,
    remaining,
    progress,
    monthlyRate,
    requiredMonthlyRate,
    monthsRemaining,
    projectedCompletion,
    targetDate: goal.targetDate,
    status: goalStatus({
      achieved,
      projectedCompletion,
      targetDate: goal.targetDate,
    }),
    contributionCount: contributions.length,
    lastContributionAt: sorted.length ? sorted[sorted.length - 1].date : null,
  };
}

export function goalStatus(input: {
  achieved: boolean;
  projectedCompletion: Date | null;
  targetDate: Date | null;
}): GoalStatus {
  if (input.achieved) return "achieved";
  if (!input.projectedCompletion) return "stalled";
  if (!input.targetDate) return "on_track";
  return input.projectedCompletion <= input.targetDate ? "ahead" : "behind";
}

export interface GoalsSummary {
  goals: GoalProjection[];
  totalTarget: number;
  totalSaved: number;
  /** Combined progress across goals, 0–1. */
  progress: number;
  achievedCount: number;
  behindCount: number;
  /** What all unfinished goals together demand per month to hit their dates. */
  requiredMonthlyTotal: number;
}

/**
 * Order the dashboard widget shows goals in: the ones that need a decision
 * first, finished ones last.
 */
const FOCUS_ORDER: Record<GoalStatus, number> = {
  behind: 0,
  stalled: 1,
  ahead: 2,
  on_track: 3,
  achieved: 4,
};

function deadlineTime(goal: GoalProjection): number {
  return goal.targetDate ? goal.targetDate.getTime() : Number.POSITIVE_INFINITY;
}

/**
 * The few goals worth showing outside the goals page: whatever is behind or
 * stalled, then whatever is due soonest. Achieved goals sort last but are not
 * dropped, so a workspace that has finished everything still sees something.
 */
export function selectFocusGoals(
  goals: readonly GoalProjection[],
  limit = 3
): GoalProjection[] {
  return [...goals]
    .sort(
      (a, b) =>
        FOCUS_ORDER[a.status] - FOCUS_ORDER[b.status] ||
        deadlineTime(a) - deadlineTime(b) ||
        b.remaining - a.remaining ||
        a.name.localeCompare(b.name)
    )
    .slice(0, Math.max(0, limit));
}

export function summarizeGoals(goals: readonly GoalProjection[]): GoalsSummary {
  const totalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);
  const totalSaved = goals.reduce((sum, g) => sum + Math.min(g.saved, g.targetAmount), 0);

  return {
    goals: [...goals].sort(
      (a, b) => Number(a.status === "achieved") - Number(b.status === "achieved") || b.progress - a.progress
    ),
    totalTarget,
    totalSaved,
    progress: totalTarget > 0 ? Math.min(1, totalSaved / totalTarget) : 0,
    achievedCount: goals.filter((g) => g.status === "achieved").length,
    behindCount: goals.filter((g) => g.status === "behind").length,
    requiredMonthlyTotal: goals.reduce((sum, g) => sum + (g.requiredMonthlyRate ?? 0), 0),
  };
}
