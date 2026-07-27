/**
 * Pure scheduling rules for the notification cron: which summaries are due
 * and whether a daily-capped alert may fire again. Kept free of IO so the
 * idempotency claim logic is unit-testable.
 */

export type SummaryKind = "daily" | "weekly" | "monthly";

export interface SummaryScheduleState {
  dailySummary: boolean;
  weeklySummary: boolean;
  monthlySummary: boolean;
  lastDailySentAt: Date | null;
  lastWeeklySentAt: Date | null;
  lastMonthlySentAt: Date | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isSameUtcDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/**
 * Summaries due at `now`:
 * - Daily: once per UTC day.
 * - Weekly: Mondays, at most once per 6 days.
 * - Monthly: the 1st, at most once per 27 days.
 */
export function dueSummaries(state: SummaryScheduleState, now: Date): SummaryKind[] {
  const due: SummaryKind[] = [];
  if (state.dailySummary && (!state.lastDailySentAt || !isSameUtcDay(state.lastDailySentAt, now))) {
    due.push("daily");
  }
  if (
    state.weeklySummary &&
    now.getUTCDay() === 1 &&
    (!state.lastWeeklySentAt || now.getTime() - state.lastWeeklySentAt.getTime() > 6 * MS_PER_DAY)
  ) {
    due.push("weekly");
  }
  if (
    state.monthlySummary &&
    now.getUTCDate() === 1 &&
    (!state.lastMonthlySentAt ||
      now.getTime() - state.lastMonthlySentAt.getTime() > 27 * MS_PER_DAY)
  ) {
    due.push("monthly");
  }
  return due;
}

/** Alerts capped at one per UTC day (low cash, invoice reminders). */
export function isDailyAlertDue(lastSentAt: Date | null, now: Date): boolean {
  return !lastSentAt || !isSameUtcDay(lastSentAt, now);
}
