import { describe, expect, it } from "vitest";

import {
  contributionCreateSchema,
  endOfUtcDay,
  goalCreateSchema,
  goalUpdateSchema,
  startOfUtcDay,
} from "@/app/api/goals/schemas";
import {
  addMonths,
  goalStatus,
  projectGoal,
  RATE_WINDOW_MONTHS,
  savingRate,
  selectFocusGoals,
  summarizeGoals,
  type GoalContribution,
  type GoalProjection,
  type GoalRow,
} from "@/lib/personal/goals";

const NOW = new Date("2026-07-15T12:00:00Z");

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function goal(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    id: "goal_1",
    name: "House deposit",
    targetAmount: 12_000,
    targetDate: null,
    startingAmount: 0,
    createdAt: day("2026-01-15"),
    achievedAt: null,
    ...overrides,
  };
}

function contributions(...entries: [string, number][]): GoalContribution[] {
  return entries.map(([iso, amount]) => ({ date: day(iso), amount }));
}

/* ------------------------------------------------------------------ */
/* Month arithmetic                                                    */
/* ------------------------------------------------------------------ */

describe("addMonths", () => {
  it("keeps the day of month when the target month is long enough", () => {
    expect(addMonths(day("2026-01-15"), 3).toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });

  it("clamps to the last day of a shorter month", () => {
    expect(addMonths(day("2026-01-31"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonths(day("2028-01-31"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(addMonths(day("2026-03-31"), 1).toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });

  it("crosses year boundaries in both directions", () => {
    expect(addMonths(day("2026-11-10"), 3).toISOString()).toBe("2027-02-10T00:00:00.000Z");
    expect(addMonths(day("2026-02-10"), -3).toISOString()).toBe("2025-11-10T00:00:00.000Z");
  });
});

/* ------------------------------------------------------------------ */
/* Saving rate                                                         */
/* ------------------------------------------------------------------ */

describe("saving rate", () => {
  it("is zero without contributions", () => {
    expect(savingRate([], day("2026-01-15"), NOW)).toBe(0);
  });

  it("averages over the months the goal has been running", () => {
    // Created in April, contributions in April, May, June, July.
    const rate = savingRate(
      contributions(["2026-04-20", 200], ["2026-05-20", 200], ["2026-06-20", 200], ["2026-07-05", 200]),
      day("2026-04-15"),
      NOW
    );
    expect(rate).toBe(200);
  });

  /**
   * The trap this guards: dividing by the number of contributions instead of
   * the elapsed months turns one old deposit into a monthly habit, and the
   * projected completion date becomes fiction.
   */
  it("does not treat a single old deposit as a monthly rate", () => {
    const rate = savingRate(contributions(["2026-03-01", 600]), day("2026-02-15"), NOW);
    // Window is the last 6 months (Feb–Jul), so 600 spread over 6 months.
    expect(rate).toBe(100);
  });

  it("counts a goal created this month as one month", () => {
    expect(savingRate(contributions(["2026-07-02", 300]), day("2026-07-01"), NOW)).toBe(300);
  });

  it("ignores contributions older than the rate window", () => {
    const older = day("2025-01-01");
    const rate = savingRate(
      contributions(["2025-06-01", 5000], ["2026-06-01", 300], ["2026-07-01", 300]),
      older,
      NOW
    );
    // Only the two in-window deposits count, spread over the 6-month window.
    expect(rate).toBeCloseTo(600 / RATE_WINDOW_MONTHS, 10);
  });

  it("ignores contributions dated in the future", () => {
    expect(savingRate(contributions(["2026-12-01", 900]), day("2026-06-01"), NOW)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

describe("goal projection", () => {
  it("adds the starting amount to the contributions", () => {
    const projection = projectGoal(
      goal({ startingAmount: 2000 }),
      contributions(["2026-06-15", 500], ["2026-07-01", 500]),
      NOW
    );
    expect(projection.saved).toBe(3000);
    expect(projection.remaining).toBe(9000);
    expect(projection.progress).toBeCloseTo(0.25, 10);
    expect(projection.contributionCount).toBe(2);
    expect(projection.lastContributionAt).toEqual(day("2026-07-01"));
  });

  it("projects completion from the actual monthly rate", () => {
    // Created in Feb, 500/month since: rate 500, 12,000 - 3,000 = 9,000 left.
    const projection = projectGoal(
      goal({ createdAt: day("2026-02-15") }),
      contributions(
        ["2026-02-20", 500],
        ["2026-03-20", 500],
        ["2026-04-20", 500],
        ["2026-05-20", 500],
        ["2026-06-20", 500],
        ["2026-07-05", 500]
      ),
      NOW
    );
    expect(projection.saved).toBe(3000);
    expect(projection.monthlyRate).toBe(500);
    expect(projection.monthsRemaining).toBe(18);
    expect(projection.projectedCompletion).toEqual(addMonths(NOW, 18));
    expect(projection.status).toBe("on_track");
  });

  it("rounds a partial month up, because the goal is not funded until it is", () => {
    const projection = projectGoal(
      goal({ targetAmount: 1000, createdAt: day("2026-07-01") }),
      contributions(["2026-07-02", 300]),
      NOW
    );
    // 700 left at 300/month is 2.33 months, so 3.
    expect(projection.monthsRemaining).toBe(3);
  });

  it("cannot project a goal nobody is saving into", () => {
    const projection = projectGoal(goal(), [], NOW);
    expect(projection.monthlyRate).toBe(0);
    expect(projection.monthsRemaining).toBeNull();
    expect(projection.projectedCompletion).toBeNull();
    expect(projection.status).toBe("stalled");
  });

  it("clamps progress and remaining once the target is passed", () => {
    const projection = projectGoal(
      goal({ targetAmount: 1000 }),
      contributions(["2026-07-01", 1500]),
      NOW
    );
    expect(projection.saved).toBe(1500);
    expect(projection.remaining).toBe(0);
    expect(projection.progress).toBe(1);
    expect(projection.status).toBe("achieved");
    expect(projection.projectedCompletion).toBeNull();
  });

  it("treats an explicitly achieved goal as done even if the maths disagrees", () => {
    const projection = projectGoal(
      goal({ achievedAt: day("2026-07-10") }),
      contributions(["2026-07-01", 10]),
      NOW
    );
    expect(projection.status).toBe("achieved");
    expect(projection.requiredMonthlyRate).toBeNull();
  });

  it("handles a zero target without dividing by zero", () => {
    const projection = projectGoal(goal({ targetAmount: 0 }), [], NOW);
    expect(projection.progress).toBe(0);
    expect(projection.remaining).toBe(0);
    expect(projection.status).toBe("achieved");
  });

  describe("with a deadline", () => {
    it("says what the deadline demands per month", () => {
      const projection = projectGoal(
        goal({ targetAmount: 6000, targetDate: day("2026-12-15"), createdAt: day("2026-07-01") }),
        contributions(["2026-07-02", 1000]),
        NOW
      );
      // 5,000 left over the 5 months to December.
      expect(projection.requiredMonthlyRate).toBe(1000);
    });

    it("is ahead when the current rate lands on or before the date", () => {
      const projection = projectGoal(
        goal({ targetAmount: 2000, targetDate: day("2026-11-15"), createdAt: day("2026-07-01") }),
        contributions(["2026-07-02", 1000]),
        NOW
      );
      expect(projection.monthsRemaining).toBe(1);
      expect(projection.status).toBe("ahead");
    });

    it("is behind when the current rate lands after the date", () => {
      const projection = projectGoal(
        goal({ targetAmount: 12_000, targetDate: day("2026-10-15"), createdAt: day("2026-07-01") }),
        contributions(["2026-07-02", 500]),
        NOW
      );
      expect(projection.status).toBe("behind");
      expect(projection.requiredMonthlyRate).toBeCloseTo(11_500 / 3, 10);
    });

    it("demands the whole remainder when the deadline is now or past", () => {
      const projection = projectGoal(
        goal({ targetAmount: 1000, targetDate: day("2026-06-01"), createdAt: day("2026-05-01") }),
        contributions(["2026-05-02", 400]),
        NOW
      );
      expect(projection.requiredMonthlyRate).toBe(600);
      expect(projection.status).toBe("behind");
    });
  });
});

describe("goal status", () => {
  const target = day("2026-12-01");

  it("resolves every combination", () => {
    expect(goalStatus({ achieved: true, projectedCompletion: null, targetDate: target })).toBe(
      "achieved"
    );
    expect(goalStatus({ achieved: false, projectedCompletion: null, targetDate: null })).toBe(
      "stalled"
    );
    expect(
      goalStatus({ achieved: false, projectedCompletion: day("2027-01-01"), targetDate: null })
    ).toBe("on_track");
    expect(
      goalStatus({ achieved: false, projectedCompletion: day("2026-11-01"), targetDate: target })
    ).toBe("ahead");
    expect(
      goalStatus({ achieved: false, projectedCompletion: target, targetDate: target })
    ).toBe("ahead");
    expect(
      goalStatus({ achieved: false, projectedCompletion: day("2027-01-01"), targetDate: target })
    ).toBe("behind");
  });
});

/* ------------------------------------------------------------------ */
/* Summary and focus                                                   */
/* ------------------------------------------------------------------ */

function projection(overrides: Partial<GoalProjection> = {}): GoalProjection {
  return {
    id: "g",
    name: "Goal",
    targetAmount: 1000,
    saved: 500,
    remaining: 500,
    progress: 0.5,
    monthlyRate: 100,
    requiredMonthlyRate: null,
    monthsRemaining: 5,
    projectedCompletion: addMonths(NOW, 5),
    targetDate: null,
    status: "on_track",
    contributionCount: 3,
    lastContributionAt: day("2026-07-01"),
    ...overrides,
  };
}

describe("summarizeGoals", () => {
  it("totals targets and caps saved at each goal's target", () => {
    const summary = summarizeGoals([
      projection({ id: "a", targetAmount: 1000, saved: 1500, status: "achieved" }),
      projection({ id: "b", targetAmount: 3000, saved: 600 }),
    ]);
    expect(summary.totalTarget).toBe(4000);
    // The 500 overshoot on the first goal does not flatter the second.
    expect(summary.totalSaved).toBe(1600);
    expect(summary.progress).toBeCloseTo(0.4, 10);
    expect(summary.achievedCount).toBe(1);
  });

  it("adds up what the deadlines demand per month", () => {
    const summary = summarizeGoals([
      projection({ id: "a", requiredMonthlyRate: 250, status: "behind" }),
      projection({ id: "b", requiredMonthlyRate: 100, status: "ahead" }),
      projection({ id: "c", requiredMonthlyRate: null }),
    ]);
    expect(summary.requiredMonthlyTotal).toBe(350);
    expect(summary.behindCount).toBe(1);
  });

  it("is empty-safe", () => {
    const summary = summarizeGoals([]);
    expect(summary).toMatchObject({
      totalTarget: 0,
      totalSaved: 0,
      progress: 0,
      achievedCount: 0,
      behindCount: 0,
      requiredMonthlyTotal: 0,
    });
    expect(summary.goals).toEqual([]);
  });

  it("sorts unfinished goals first, then by progress", () => {
    const summary = summarizeGoals([
      projection({ id: "done", status: "achieved", progress: 1 }),
      projection({ id: "low", progress: 0.1 }),
      projection({ id: "high", progress: 0.8 }),
    ]);
    expect(summary.goals.map((entry) => entry.id)).toEqual(["high", "low", "done"]);
  });
});

describe("selectFocusGoals", () => {
  it("surfaces what needs a decision before what is fine", () => {
    const focus = selectFocusGoals([
      projection({ id: "ok", status: "on_track" }),
      projection({ id: "done", status: "achieved" }),
      projection({ id: "stalled", status: "stalled" }),
      projection({ id: "behind", status: "behind" }),
    ]);
    expect(focus.map((entry) => entry.id)).toEqual(["behind", "stalled", "ok"]);
  });

  it("breaks ties on the nearest deadline", () => {
    const focus = selectFocusGoals([
      projection({ id: "later", status: "behind", targetDate: day("2027-01-01") }),
      projection({ id: "sooner", status: "behind", targetDate: day("2026-09-01") }),
      projection({ id: "undated", status: "behind", targetDate: null }),
    ]);
    expect(focus.map((entry) => entry.id)).toEqual(["sooner", "later", "undated"]);
  });

  it("still shows something when everything is finished", () => {
    const focus = selectFocusGoals([
      projection({ id: "a", status: "achieved" }),
      projection({ id: "b", status: "achieved" }),
    ]);
    expect(focus).toHaveLength(2);
  });

  it("respects the limit and never returns a negative slice", () => {
    const goals = [1, 2, 3, 4, 5].map((n) => projection({ id: `g${n}` }));
    expect(selectFocusGoals(goals, 2)).toHaveLength(2);
    expect(selectFocusGoals(goals, 0)).toHaveLength(0);
    expect(selectFocusGoals(goals, -1)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

describe("goal request validation", () => {
  it("accepts a goal with only a name and a target", () => {
    const parsed = goalCreateSchema.safeParse({ name: "  Japan trip  ", targetAmount: "3500" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe("Japan trip");
    expect(parsed.data?.targetAmount).toBe(3500);
  });

  it("rejects an empty name and a non-positive target", () => {
    expect(goalCreateSchema.safeParse({ name: "   ", targetAmount: 100 }).success).toBe(false);
    expect(goalCreateSchema.safeParse({ name: "Goal", targetAmount: 0 }).success).toBe(false);
    expect(goalCreateSchema.safeParse({ name: "Goal", targetAmount: -5 }).success).toBe(false);
    expect(goalCreateSchema.safeParse({ name: "Goal" }).success).toBe(false);
  });

  it("allows a starting amount of zero but not a negative one", () => {
    expect(
      goalCreateSchema.safeParse({ name: "Goal", targetAmount: 10, startingAmount: 0 }).success
    ).toBe(true);
    expect(
      goalCreateSchema.safeParse({ name: "Goal", targetAmount: 10, startingAmount: -1 }).success
    ).toBe(false);
  });

  it("coerces the target date and accepts none", () => {
    const dated = goalCreateSchema.parse({
      name: "Goal",
      targetAmount: 10,
      targetDate: "2027-01-31",
    });
    expect(dated.targetDate?.toISOString()).toBe("2027-01-31T00:00:00.000Z");
    expect(goalCreateSchema.parse({ name: "Goal", targetAmount: 10 }).targetDate).toBeUndefined();
    expect(
      goalCreateSchema.parse({ name: "Goal", targetAmount: 10, targetDate: null }).targetDate
    ).toBeNull();
  });

  /**
   * The update schema has to tell "leave it alone" from "clear it", or a link
   * could never be removed without resending the whole goal.
   */
  it("distinguishes an omitted field from an explicit null on update", () => {
    const untouched = goalUpdateSchema.parse({});
    expect("categoryId" in untouched && untouched.categoryId !== undefined).toBe(false);

    const cleared = goalUpdateSchema.parse({ categoryId: null, targetDate: null });
    expect(cleared.categoryId).toBeNull();
    expect(cleared.targetDate).toBeNull();
  });

  it("validates a contribution", () => {
    const parsed = contributionCreateSchema.safeParse({ amount: "250.50", date: "2026-07-01" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.amount).toBe(250.5);
    expect(contributionCreateSchema.safeParse({ amount: 0, date: "2026-07-01" }).success).toBe(
      false
    );
    expect(contributionCreateSchema.safeParse({ amount: 10 }).success).toBe(false);
    expect(
      contributionCreateSchema.safeParse({ amount: 10, date: "not a date" }).success
    ).toBe(false);
  });

  it("caps free text so a note cannot be used as storage", () => {
    expect(
      goalCreateSchema.safeParse({ name: "Goal", targetAmount: 10, note: "x".repeat(501) }).success
    ).toBe(false);
    expect(goalCreateSchema.safeParse({ name: "x".repeat(81), targetAmount: 10 }).success).toBe(
      false
    );
  });

  it("compares target dates by day, not by moment", () => {
    const midMorning = new Date("2026-07-15T09:30:00Z");
    expect(startOfUtcDay(midMorning).toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(endOfUtcDay(midMorning).toISOString()).toBe("2026-07-15T23:59:59.999Z");
    expect(endOfUtcDay(midMorning).getTime() - startOfUtcDay(midMorning).getTime()).toBe(
      24 * 60 * 60 * 1000 - 1
    );
  });
});
