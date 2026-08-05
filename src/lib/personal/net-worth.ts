/**
 * Net worth: what is owned minus what is owed — pure arithmetic, no database,
 * no Prisma types. The loader lives in ./net-worth-data.ts.
 *
 * Ballast Personal has always seen *flows* (transactions in and out). Net worth
 * is the *stock*: the house, the car, the index fund, the mortgage, plus the
 * cash the banks already report. Three rules keep the figure honest, and all
 * three are deliberate:
 *
 *  - **Bank cash is never entered by hand.** Synced balances come in through
 *    `computeCashPosition` (which is also what applies each account's
 *    `includeInTotals` switch), and an `Asset` row exists for what is *not*
 *    synced. That separation is the only thing standing between a user and a
 *    double-counted current account, so the UI copy says so too.
 *  - **Liabilities are entered positive and subtracted.** Nobody types a
 *    mortgage as −250,000, and a stored sign is one more thing that can
 *    disagree with the kind.
 *  - **No FX, ever.** A holding in another currency is reported but never
 *    summed, exactly as `computeCashPosition` treats a foreign account: there
 *    is no exchange rate anywhere in this app, and inventing one would
 *    misstate the headline number rather than admit it does not know.
 */

/** Mirrors the Prisma `AssetKind` enum, in the same order. */
export const ASSET_KINDS = [
  "PROPERTY",
  "VEHICLE",
  "INVESTMENT",
  "CRYPTO",
  "CASH",
  "OTHER_ASSET",
  "LOAN",
  "MORTGAGE",
  "CREDIT_LINE",
  "OTHER_LIABILITY",
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * The kinds that are owed rather than owned. This is the single definition of
 * which side of the balance a holding falls on — nothing is stored per row, so
 * an asset can never disagree with its own kind.
 */
export const LIABILITY_KINDS = [
  "LOAN",
  "MORTGAGE",
  "CREDIT_LINE",
  "OTHER_LIABILITY",
] as const satisfies readonly AssetKind[];

export function isLiabilityKind(kind: AssetKind): boolean {
  return (LIABILITY_KINDS as readonly AssetKind[]).includes(kind);
}

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  PROPERTY: "Property",
  VEHICLE: "Vehicle",
  INVESTMENT: "Investments",
  CRYPTO: "Crypto",
  CASH: "Cash & savings",
  OTHER_ASSET: "Other asset",
  LOAN: "Loan",
  MORTGAGE: "Mortgage",
  CREDIT_LINE: "Credit card / overdraft",
  OTHER_LIABILITY: "Other debt",
};

/** One row of an asset's append-only valuation history. */
export interface Valuation {
  value: number;
  asOf: Date;
}

export interface AssetInput {
  id: string;
  name: string;
  kind: AssetKind;
  /** Null means the workspace currency. */
  currency: string | null;
  note: string | null;
  createdAt: Date;
  /** Any order; the maths sorts by `asOf` itself. */
  valuations: readonly Valuation[];
}

/** Why a holding is or is not part of the total. */
export type AssetReason =
  /** Valued, in the workspace currency, and in the total. */
  | "counted"
  /** Held in another currency, so reported but never summed. */
  | "other-currency"
  /** No valuation has ever been entered: worth 0 until one is. */
  | "unvalued";

export interface AssetPosition {
  id: string;
  name: string;
  kind: AssetKind;
  isLiability: boolean;
  currency: string | null;
  note: string | null;
  /** The latest valuation, or 0 when there is none. Always positive. */
  value: number;
  /** The date the latest valuation describes. */
  asOf: Date | null;
  valuationCount: number;
  /** The valuation before the latest one; null when there is only one. */
  previousValue: number | null;
  /** Movement since the previous valuation. Null when there is nothing to compare. */
  change: number | null;
  counted: boolean;
  reason: AssetReason;
}

export interface NetWorthInput {
  assets: readonly AssetInput[];
  /**
   * Bank and cash total from `computeCashPosition` — already net of accounts
   * the user excluded from totals and of accounts held in another currency.
   */
  cash: number;
  /** The workspace currency. Only holdings in it are summed. */
  currency: string;
}

export interface NetWorthPosition {
  currency: string;
  /** `assetTotal + cash − liabilityTotal`. */
  netWorth: number;
  /** Latest valuations of everything owned, excluding bank cash. */
  assetTotal: number;
  /** Latest valuations of everything owed, as a positive number. */
  liabilityTotal: number;
  /** The bank/cash figure that went into the total. */
  cash: number;
  /** `assetTotal + cash` — the whole asset side, for the ratio and the copy. */
  totalAssets: number;
  /** Owned holdings, largest first. */
  assets: AssetPosition[];
  /** Owed holdings, largest first. */
  liabilities: AssetPosition[];
  /** Holdings in another currency: reported, never summed. */
  otherCurrencyCount: number;
  /** Holdings nobody has put a figure on yet, which are worth prompting for. */
  unvaluedCount: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Newest valuation first. Two figures for the same day keep the order they
 * arrived in — `Array.sort` is stable, and `valuationAsOf` likewise keeps the
 * first of equal dates — so the loader deciding that order (newest entry
 * first) is what makes a same-day correction win.
 */
function byAsOfDesc(a: Valuation, b: Valuation): number {
  return b.asOf.getTime() - a.asOf.getTime();
}

/**
 * The valuation in force on a date: the most recent one not after it. This is
 * what carries a figure forward through months that have no new valuation, and
 * returning `null` before the first one is what keeps a holding out of the
 * history until it existed.
 */
export function valuationAsOf(
  valuations: readonly Valuation[],
  when: Date
): Valuation | null {
  let best: Valuation | null = null;
  for (const valuation of valuations) {
    if (valuation.asOf.getTime() > when.getTime()) continue;
    if (!best || valuation.asOf.getTime() > best.asOf.getTime()) best = valuation;
  }
  return best;
}

function classify(asset: AssetInput, currency: string): AssetReason {
  if (asset.currency && asset.currency.toUpperCase() !== currency.toUpperCase()) {
    return "other-currency";
  }
  return asset.valuations.length === 0 ? "unvalued" : "counted";
}

function toPosition(asset: AssetInput, currency: string): AssetPosition {
  const sorted = [...asset.valuations].sort(byAsOfDesc);
  const latest = sorted[0] ?? null;
  const previous = sorted[1] ?? null;
  const reason = classify(asset, currency);

  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    isLiability: isLiabilityKind(asset.kind),
    currency: asset.currency,
    note: asset.note,
    value: latest ? round2(latest.value) : 0,
    asOf: latest?.asOf ?? null,
    valuationCount: asset.valuations.length,
    previousValue: previous ? round2(previous.value) : null,
    change: latest && previous ? round2(latest.value - previous.value) : null,
    // An unvalued holding is still "counted" — it contributes exactly 0, which
    // is the honest answer until somebody enters a figure. Only a foreign
    // currency takes a holding out of the sum.
    counted: reason !== "other-currency",
    reason,
  };
}

function byValueDesc(a: AssetPosition, b: AssetPosition): number {
  return b.value - a.value || a.name.localeCompare(b.name);
}

export function computeNetWorth(input: NetWorthInput): NetWorthPosition {
  const positions = input.assets.map((asset) => toPosition(asset, input.currency));

  const assets = positions.filter((position) => !position.isLiability).sort(byValueDesc);
  const liabilities = positions.filter((position) => position.isLiability).sort(byValueDesc);

  const sum = (rows: AssetPosition[]) =>
    round2(rows.reduce((total, row) => total + (row.counted ? row.value : 0), 0));

  const assetTotal = sum(assets);
  const liabilityTotal = sum(liabilities);
  const cash = round2(input.cash);

  return {
    currency: input.currency,
    netWorth: round2(assetTotal + cash - liabilityTotal),
    assetTotal,
    liabilityTotal,
    cash,
    totalAssets: round2(assetTotal + cash),
    assets,
    liabilities,
    otherCurrencyCount: positions.filter((p) => p.reason === "other-currency").length,
    unvaluedCount: positions.filter((p) => p.reason === "unvalued").length,
  };
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

/** How many months the net-worth chart covers. */
export const HISTORY_MONTHS = 12;

/** How many months of trend the copilot's snapshot carries. */
export const SNAPSHOT_TREND_MONTHS = 6;

/** A month of transaction flow, keyed `YYYY-MM`. */
export interface MonthNet {
  month: string;
  net: number;
}

/** A month-end cash balance, keyed `YYYY-MM`. */
export interface MonthCash {
  month: string;
  balance: number;
}

export interface NetWorthPoint {
  /** `YYYY-MM`. */
  month: string;
  /** e.g. "Aug 2026". */
  label: string;
  /** Owned holdings at the end of the month, carried forward. */
  assets: number;
  /** Owed holdings at the end of the month, positive. */
  liabilities: number;
  cash: number;
  netWorth: number;
}

/** `YYYY-MM` for a date, in UTC — the key every series in this file joins on. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The last instant of a `YYYY-MM`, so "as of this month" includes all of it. */
export function endOfMonth(month: string): Date {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index, 1) - 1);
}

/** The `HISTORY_MONTHS`-long axis ending with the month `now` falls in. */
export function monthAxis(now: Date, months = HISTORY_MONTHS): string[] {
  const axis: string[] = [];
  for (let index = months - 1; index >= 0; index--) {
    axis.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1))));
  }
  return axis;
}

/**
 * Month-end cash balances from monthly transaction flow.
 *
 * `openingBalance` is the cumulative net of everything recorded before the
 * first month on the axis, so the series starts at the right level rather than
 * at zero. `anchorTo` then shifts the whole line so its last point equals the
 * banks' own total: the *shape* is real (it is the imported flow) but the
 * *level* is only as complete as the imports, and the banks are the authority
 * on where cash stands today. This is the same reasoning — and the same
 * arithmetic — as `anchorBalanceHistory` in src/lib/finance/cash.ts.
 */
export function monthEndCashSeries(
  months: readonly MonthNet[],
  openingBalance: number,
  anchorTo: number | null = null
): MonthCash[] {
  let running = openingBalance;
  const series = months.map((month) => {
    running += month.net;
    return { month: month.month, balance: round2(running) };
  });

  if (anchorTo === null || series.length === 0) return series;
  const delta = anchorTo - series[series.length - 1].balance;
  if (Math.abs(delta) < 0.005) return series;
  return series.map((point) => ({ ...point, balance: round2(point.balance + delta) }));
}

export interface NetWorthHistoryInput {
  assets: readonly AssetInput[];
  /** Month-end cash per month, oldest first. Defines the axis. */
  cash: readonly MonthCash[];
  currency: string;
}

/**
 * The net-worth line, one point per month.
 *
 * Valuations are sparse by nature — somebody revalues their house once a year,
 * not every month — so each month takes the most recent valuation *on or
 * before* its last day and the figure carries forward until a newer one
 * appears. A month before a holding's first valuation contributes nothing,
 * which is what stops a house bought in June from appearing to have been owned
 * all year.
 */
export function buildNetWorthHistory(input: NetWorthHistoryInput): NetWorthPoint[] {
  const summable = input.assets.filter(
    (asset) =>
      !asset.currency || asset.currency.toUpperCase() === input.currency.toUpperCase()
  );

  return input.cash.map((month) => {
    const cutoff = endOfMonth(month.month);
    let assets = 0;
    let liabilities = 0;

    for (const asset of summable) {
      const valuation = valuationAsOf(asset.valuations, cutoff);
      if (!valuation) continue;
      if (isLiabilityKind(asset.kind)) liabilities += valuation.value;
      else assets += valuation.value;
    }

    assets = round2(assets);
    liabilities = round2(liabilities);

    return {
      month: month.month,
      label: monthLabel(month.month),
      assets,
      liabilities,
      cash: month.balance,
      netWorth: round2(assets + month.balance - liabilities),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Summarising                                                         */
/* ------------------------------------------------------------------ */

export interface NetWorthTrend {
  /** Change over the whole series. Null when there is nothing to compare. */
  change: number | null;
  /** Change as a share of the opening figure; null when it was 0 or absent. */
  changePct: number | null;
  /** Change since the previous month. Null with fewer than two points. */
  monthChange: number | null;
}

/**
 * How the line moved. Percentages are left null rather than computed from a
 * zero or negative opening figure, where "up 400%" would be arithmetically
 * true and completely meaningless.
 */
export function summarizeTrend(history: readonly NetWorthPoint[]): NetWorthTrend {
  if (history.length === 0) return { change: null, changePct: null, monthChange: null };

  const first = history[0];
  const last = history[history.length - 1];
  const change = history.length > 1 ? round2(last.netWorth - first.netWorth) : null;

  return {
    change,
    changePct:
      change !== null && first.netWorth > 0
        ? Math.round((change / first.netWorth) * 100)
        : null,
    monthChange:
      history.length > 1
        ? round2(last.netWorth - history[history.length - 2].netWorth)
        : null,
  };
}

/** The biggest holdings worth naming outside the page — for the copilot. */
export function selectLargestAssets(
  assets: readonly AssetPosition[],
  limit = 3
): AssetPosition[] {
  return assets
    .filter((asset) => asset.counted && asset.value > 0)
    .sort(byValueDesc)
    .slice(0, Math.max(0, limit));
}
