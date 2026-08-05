import type { ForecastPoint, ForecastResult } from "./forecast";

/**
 * Named forecast scenarios: the pure half.
 *
 * A scenario is a *name for a set of assumptions*, nothing more. The forecast
 * engine is untouched by this file — `computeForecast` simply runs once per
 * scenario over that scenario's assumptions, which is why comparing three
 * scenarios costs three passes over the same in-memory history and no new
 * modelling.
 *
 * The base scenario is deliberately not a row. An assumption written before
 * scenarios existed holds `scenarioId = null`, and `null` *is* the base
 * scenario rather than a value waiting to be backfilled — so every assumption
 * that already exists keeps working, and a workspace that never names a
 * scenario sees exactly the page it saw before. URLs and request bodies need
 * something to say instead of "null", which is what `BASE_SCENARIO_ID` is for.
 */

/** What the base (NULL) scenario is called in a URL or a request body. */
export const BASE_SCENARIO_ID = "base";

/** What the base scenario is called on screen and in AI prompts. */
export const BASE_SCENARIO_NAME = "Base case";

/**
 * How many scenarios can be drawn on one chart. Three lines is where a reader
 * can still tell them apart; the fourth is where a comparison becomes a mess.
 */
export const MAX_COMPARED_SCENARIOS = 3;

/** Line colours by position in the comparison, primary first. */
export const SCENARIO_COLORS = [
  "var(--chart-projected)",
  "var(--chart-2)",
  "var(--chart-3)",
] as const;

export interface ScenarioSummary {
  /** `BASE_SCENARIO_ID` for the base scenario, otherwise the row id. */
  id: string;
  name: string;
  /** The scenario the page opens on when the URL asks for nothing. */
  isDefault: boolean;
  assumptionCount: number;
  enabledAssumptionCount: number;
}

/** The colour a scenario is drawn in, given its position in the comparison. */
export function scenarioColor(index: number): string {
  return SCENARIO_COLORS[index % SCENARIO_COLORS.length];
}

/** Recharts `dataKey` for the nth scenario's projected line. */
export function scenarioSeriesKey(index: number): string {
  return `s${index}`;
}

/** URL/body id → the value stored in `Assumption.scenarioId`. */
export function toScenarioColumn(id: string | null | undefined): string | null {
  return !id || id === BASE_SCENARIO_ID ? null : id;
}

/** `Assumption.scenarioId` → the id used in URLs, bodies and React keys. */
export function toScenarioId(column: string | null): string {
  return column ?? BASE_SCENARIO_ID;
}

/**
 * The assumptions belonging to one scenario. This is the whole of the
 * scenario mechanism as far as the engine is concerned: filter, then compute.
 */
export function assumptionsInScenario<T extends { scenarioId: string | null }>(
  rows: T[],
  id: string | null | undefined
): T[] {
  const column = toScenarioColumn(id);
  return rows.filter((row) => row.scenarioId === column);
}

/**
 * The scenario a request is about: what it asked for if that exists, else the
 * workspace's default, else the base scenario. Deleting the scenario you were
 * looking at therefore lands you back on the base one rather than on an error.
 */
export function resolveActiveScenarioId(
  requested: string | null | undefined,
  scenarios: ScenarioSummary[]
): string {
  if (requested && scenarios.some((scenario) => scenario.id === requested)) return requested;
  return scenarios.find((scenario) => scenario.isDefault)?.id ?? BASE_SCENARIO_ID;
}

/**
 * The scenarios to draw, primary first: the active one plus whatever the
 * `compare` parameter names. Unknown ids, duplicates and the primary repeated
 * are dropped, and the result is capped at `MAX_COMPARED_SCENARIOS` — so a
 * hand-edited URL degrades to a smaller comparison instead of an error, and
 * comparing against nothing is just the normal single-scenario view.
 */
export function resolveComparedScenarioIds(
  primaryId: string,
  requested: string | readonly string[] | null | undefined,
  scenarios: ScenarioSummary[]
): string[] {
  const raw =
    typeof requested === "string" ? requested.split(",") : Array.isArray(requested) ? requested : [];
  const known = new Set(scenarios.map((scenario) => scenario.id));
  const ids = [primaryId];
  for (const candidate of raw) {
    const id = candidate.trim();
    if (!id || ids.includes(id) || !known.has(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_COMPARED_SCENARIOS) break;
  }
  return ids;
}

/**
 * A name for a copy that is not already taken: "Base case (copy)", then
 * "Base case (copy 2)". The database has a unique index on
 * (workspaceId, name), so duplicating twice has to produce two names.
 */
export function nextCopyName(source: string, taken: Iterable<string>): string {
  const existing = new Set(taken);
  const first = `${source} (copy)`;
  if (!existing.has(first)) return first;
  for (let n = 2; n < 100; n++) {
    const candidate = `${source} (copy ${n})`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${source} (copy ${Date.now()})`;
}

/** Where a duplicated assumption is going. */
export interface AssumptionCopyTarget {
  workspaceId: string;
  userId: string;
  scenarioId: string;
}

/**
 * The columns a duplicate carries over. `TAmount` is generic so a Prisma row's
 * `Decimal | null` passes through untouched — a copy must be the same numbers,
 * not the same numbers after a round-trip through a float.
 */
export interface AssumptionCopy<TAmount> {
  kind: "ONE_OFF" | "RECURRING" | "PERCENT_GROWTH";
  type: "INCOME" | "EXPENSE";
  label: string;
  amount: TAmount;
  percent: TAmount;
  date: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  enabled: boolean;
}

/**
 * Rewrites a scenario's assumptions as rows for another scenario. Ids, authors
 * and timestamps are deliberately not carried over: these are new rows that say
 * the same thing, which is what makes "duplicate, change one number, compare"
 * safe — editing the copy can never reach back into the original.
 */
export function assumptionCopies<TAmount>(
  rows: readonly AssumptionCopy<TAmount>[],
  target: AssumptionCopyTarget
): (AssumptionCopyTarget & AssumptionCopy<TAmount>)[] {
  return rows.map((row) => ({
    ...target,
    kind: row.kind,
    type: row.type,
    label: row.label,
    amount: row.amount,
    percent: row.percent,
    date: row.date,
    startDate: row.startDate,
    endDate: row.endDate,
    enabled: row.enabled,
  }));
}

export interface ScenarioQuotaCheck {
  allowed: boolean;
  used: number;
  /** null = unlimited, 0 = the plan has no scenarios at all. */
  limit: number | null;
}

/**
 * The per-plan scenario cap, counted like seats and bank connections. The base
 * scenario is not counted: it is not a row, and a plan that allowed zero named
 * scenarios would still have a working forecast.
 */
export function canAddScenario(current: number, limit: number | null): ScenarioQuotaCheck {
  return { allowed: limit === null || current < limit, used: current, limit };
}

export interface ComparedScenario {
  id: string;
  name: string;
  forecast: ForecastResult;
}

export interface ScenarioDelta {
  id: string;
  name: string;
  /** The scenario everything else is compared against. */
  isPrimary: boolean;
  balance30d: number;
  balance90d: number;
  balance12m: number;
  /** Months until cash reaches zero; null = projected cash-flow positive. */
  runwayMonths: number | null;
  /** Difference against the primary scenario; 0 on the primary row itself. */
  delta30d: number;
  delta90d: number;
  delta12m: number;
  /**
   * Months of runway gained or lost against the primary. Null when either side
   * never runs out of cash, because "infinite minus 8 months" is not a number
   * worth printing.
   */
  runwayDeltaMonths: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The delta table: absolute figures per scenario plus the gap to the primary. */
export function scenarioDeltas(compared: ComparedScenario[]): ScenarioDelta[] {
  const primary = compared[0];
  if (!primary) return [];
  const base = primary.forecast.metrics;

  return compared.map((entry, index) => {
    const m = entry.forecast.metrics;
    return {
      id: entry.id,
      name: entry.name,
      isPrimary: index === 0,
      balance30d: m.projectedBalance30d,
      balance90d: m.projectedBalance90d,
      balance12m: m.projectedBalance12m,
      runwayMonths: m.runwayMonths,
      delta30d: round2(m.projectedBalance30d - base.projectedBalance30d),
      delta90d: round2(m.projectedBalance90d - base.projectedBalance90d),
      delta12m: round2(m.projectedBalance12m - base.projectedBalance12m),
      runwayDeltaMonths:
        m.runwayMonths === null || base.runwayMonths === null
          ? null
          : round2(m.runwayMonths - base.runwayMonths),
    };
  });
}

export type HorizonKey = "d30" | "d90" | "m12";

/**
 * One row per date, carrying every scenario's projected balance. The index
 * signature is what lets Recharts address a line by `dataKey="s1"`.
 */
export interface ComparisonSeriesRow {
  date: string;
  /** History, which no assumption can change — taken from the primary. */
  actual: number | null;
  /** Confidence band on the primary only: three overlaid bands is noise. */
  band: [number, number] | null;
  [seriesKey: string]: string | number | [number, number] | null | undefined;
}

/**
 * A scenario's chart data on its own, without the rest of the `ForecastResult`.
 * This is what crosses to the browser: three full forecasts would be three
 * times the recurring items, bills and metrics the comparison never draws.
 */
export interface ScenarioSeries {
  id: string;
  name: string;
  horizons: Record<HorizonKey, ForecastPoint[]>;
}

/** Narrows computed forecasts to what the comparison chart needs. */
export function toScenarioSeries(compared: ComparedScenario[]): ScenarioSeries[] {
  return compared.map((entry) => ({
    id: entry.id,
    name: entry.name,
    horizons: entry.forecast.horizons,
  }));
}

/**
 * Merges the scenarios' horizon series onto one date axis. Every scenario was
 * computed from the same history at the same `now`, so the dates line up; a
 * scenario missing a date still gets an explicit null rather than a gap the
 * chart would interpolate across.
 */
export function buildComparisonSeries(
  series: ScenarioSeries[],
  horizon: HorizonKey
): ComparisonSeriesRow[] {
  const primary = series[0];
  if (!primary) return [];

  const others = series.slice(1).map((entry) => {
    const byDate = new Map<string, number | null>();
    for (const point of entry.horizons[horizon]) byDate.set(point.date, point.projected);
    return byDate;
  });

  return primary.horizons[horizon].map((point) => {
    const row: ComparisonSeriesRow = {
      date: point.date,
      actual: point.actual,
      band: point.band,
      [scenarioSeriesKey(0)]: point.projected,
    };
    others.forEach((byDate, index) => {
      row[scenarioSeriesKey(index + 1)] = byDate.get(point.date) ?? null;
    });
    return row;
  });
}
