/**
 * Reporting period resolution, shared by the /reports page and the export
 * API routes. All boundaries are UTC; `to` is inclusive (end of day).
 */

export const PERIOD_PRESETS = [
  "this-month",
  "last-month",
  "quarter",
  "ytd",
  "last-12m",
  "custom",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface ResolvedPeriod {
  preset: PeriodPreset;
  from: Date;
  to: Date;
  label: string;
}

const MONTH_LABEL: Intl.DateTimeFormatOptions = { month: "short", year: "numeric", timeZone: "UTC" };
const DAY_LABEL: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
};

function endOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)
  );
}

function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

function monthEnd(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
}

function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function resolvePeriod(
  preset: string | undefined,
  fromParam?: string,
  toParam?: string,
  now = new Date()
): ResolvedPeriod {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = endOfDay(now);

  if (preset === "custom") {
    const from = parseDay(fromParam);
    const to = parseDay(toParam);
    if (from && to && from <= to) {
      return {
        preset: "custom",
        from,
        to: endOfDay(to),
        label: `${from.toLocaleDateString("en-US", DAY_LABEL)} – ${to.toLocaleDateString("en-US", DAY_LABEL)}`,
      };
    }
    // Invalid custom range falls through to the default preset.
  }

  switch (preset) {
    case "last-month": {
      const from = monthStart(year, month - 1);
      return {
        preset: "last-month",
        from,
        to: monthEnd(year, month - 1),
        label: from.toLocaleDateString("en-US", MONTH_LABEL),
      };
    }
    case "quarter": {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const from = monthStart(year, quarterStartMonth);
      return {
        preset: "quarter",
        from,
        to: today,
        label: `Q${Math.floor(month / 3) + 1} ${year}`,
      };
    }
    case "ytd": {
      return {
        preset: "ytd",
        from: monthStart(year, 0),
        to: today,
        label: `${year} year to date`,
      };
    }
    case "last-12m": {
      return {
        preset: "last-12m",
        from: monthStart(year, month - 11),
        to: today,
        label: "Last 12 months",
      };
    }
    default: {
      const from = monthStart(year, month);
      return {
        preset: "this-month",
        from,
        to: today,
        label: from.toLocaleDateString("en-US", MONTH_LABEL),
      };
    }
  }
}

/**
 * The comparison window for period-over-period deltas: the same calendar
 * span for month/quarter/ytd presets, or the immediately preceding window of
 * equal length for rolling/custom ranges.
 */
export function previousPeriod(period: ResolvedPeriod): { from: Date; to: Date } {
  const { from, to } = period;
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();

  switch (period.preset) {
    case "this-month":
    case "last-month":
      return { from: monthStart(year, month - 1), to: monthEnd(year, month - 1) };
    case "quarter":
      return { from: monthStart(year, month - 3), to: monthEnd(year, month - 1) };
    case "ytd":
      // Same range one year earlier.
      return {
        from: monthStart(year - 1, 0),
        to: endOfDay(
          new Date(Date.UTC(year - 1, to.getUTCMonth(), Math.min(to.getUTCDate(), 28)))
        ),
      };
    default: {
      const spanMs = to.getTime() - from.getTime();
      return { from: new Date(from.getTime() - spanMs - 1), to: new Date(from.getTime() - 1) };
    }
  }
}
