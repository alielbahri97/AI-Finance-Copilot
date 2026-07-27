import { describe, expect, it } from "vitest";

import {
  dueSummaries,
  isDailyAlertDue,
  isSameUtcDay,
  type SummaryScheduleState,
} from "@/lib/notifications/schedule";

// 2026-07-27 is a Monday.
const MONDAY = new Date("2026-07-27T09:00:00Z");
const TUESDAY = new Date("2026-07-28T09:00:00Z");
const FIRST_OF_MONTH = new Date("2026-08-01T02:00:00Z");

function state(overrides: Partial<SummaryScheduleState> = {}): SummaryScheduleState {
  return {
    dailySummary: true,
    weeklySummary: true,
    monthlySummary: true,
    lastDailySentAt: null,
    lastWeeklySentAt: null,
    lastMonthlySentAt: null,
    ...overrides,
  };
}

describe("summary scheduling / idempotency", () => {
  it("sends the daily summary once per UTC day", () => {
    expect(dueSummaries(state(), MONDAY)).toContain("daily");
    // Re-run in the same UTC day after the claim: no longer due.
    expect(dueSummaries(state({ lastDailySentAt: MONDAY }), new Date("2026-07-27T23:00:00Z"))).not.toContain("daily");
    // Next day: due again.
    expect(dueSummaries(state({ lastDailySentAt: MONDAY }), TUESDAY)).toContain("daily");
  });

  it("sends the weekly summary on Mondays only, at most once per 6 days", () => {
    expect(dueSummaries(state(), MONDAY)).toContain("weekly");
    expect(dueSummaries(state(), TUESDAY)).not.toContain("weekly");
    // Sent earlier the same Monday: not due on a re-run.
    expect(
      dueSummaries(state({ lastWeeklySentAt: new Date("2026-07-27T01:00:00Z") }), MONDAY)
    ).not.toContain("weekly");
    // Last sent the previous Monday: due again.
    expect(
      dueSummaries(state({ lastWeeklySentAt: new Date("2026-07-20T09:00:00Z") }), MONDAY)
    ).toContain("weekly");
  });

  it("sends the monthly summary on the 1st, at most once per 27 days", () => {
    expect(dueSummaries(state(), FIRST_OF_MONTH)).toContain("monthly");
    expect(dueSummaries(state(), MONDAY)).not.toContain("monthly");
    expect(
      dueSummaries(state({ lastMonthlySentAt: new Date("2026-07-01T02:00:00Z") }), FIRST_OF_MONTH)
    ).toContain("monthly");
    expect(
      dueSummaries(
        state({ lastMonthlySentAt: new Date("2026-08-01T00:30:00Z") }),
        FIRST_OF_MONTH
      )
    ).not.toContain("monthly");
  });

  it("respects per-kind opt-outs", () => {
    const due = dueSummaries(
      state({ dailySummary: false, weeklySummary: false, monthlySummary: false }),
      MONDAY
    );
    expect(due).toHaveLength(0);
  });
});

describe("daily-capped alerts", () => {
  it("fires when never sent", () => {
    expect(isDailyAlertDue(null, MONDAY)).toBe(true);
  });

  it("does not fire twice within the same UTC day", () => {
    expect(isDailyAlertDue(new Date("2026-07-27T00:10:00Z"), MONDAY)).toBe(false);
  });

  it("fires again the next UTC day", () => {
    expect(isDailyAlertDue(MONDAY, TUESDAY)).toBe(true);
  });
});

describe("isSameUtcDay", () => {
  it("compares by UTC calendar day, not 24h windows", () => {
    expect(isSameUtcDay(new Date("2026-07-27T00:01:00Z"), new Date("2026-07-27T23:59:00Z"))).toBe(
      true
    );
    expect(isSameUtcDay(new Date("2026-07-27T23:59:00Z"), new Date("2026-07-28T00:01:00Z"))).toBe(
      false
    );
  });
});
