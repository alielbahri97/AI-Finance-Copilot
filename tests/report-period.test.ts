import { describe, expect, it } from "vitest";

import { previousPeriod, resolvePeriod } from "@/lib/reports/period";

const NOW = new Date("2026-07-27T10:00:00Z");

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("report period resolution", () => {
  it("resolves this-month from the 1st through now", () => {
    const period = resolvePeriod("this-month", undefined, undefined, NOW);
    expect(iso(period.from)).toBe("2026-07-01");
  });

  it("resolves the previous comparable period", () => {
    const prev = previousPeriod(resolvePeriod("this-month", undefined, undefined, NOW));
    expect(iso(prev.from)).toBe("2026-06-01");
    expect(iso(prev.to)).toBe("2026-06-30");
  });

  it("labels quarters", () => {
    expect(resolvePeriod("quarter", undefined, undefined, NOW).label).toBe("Q3 2026");
  });

  it("accepts a valid custom range", () => {
    const custom = resolvePeriod("custom", "2026-01-15", "2026-02-14", NOW);
    expect(custom.preset).toBe("custom");
    expect(iso(custom.from)).toBe("2026-01-15");
  });

  it("falls back to this-month for an inverted custom range", () => {
    const invalid = resolvePeriod("custom", "2026-05-01", "2026-01-01", NOW);
    expect(invalid.preset).toBe("this-month");
  });
});
