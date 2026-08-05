import type { AssetKind, AssetReason } from "@/lib/personal/net-worth";

/**
 * What the client components receive. Dates are ISO days rather than `Date`
 * objects: these props cross the server/client boundary and a date input wants
 * `YYYY-MM-DD` anyway.
 */

export interface ValuationItem {
  id: string;
  value: number;
  /** `YYYY-MM-DD`. */
  asOf: string;
}

export interface HoldingRow {
  id: string;
  name: string;
  kind: AssetKind;
  isLiability: boolean;
  /** Null means the workspace currency. */
  currency: string | null;
  note: string | null;
  /** The latest valuation, or 0 when there is none. Always positive. */
  value: number;
  /** `YYYY-MM-DD` of the latest valuation. */
  asOf: string | null;
  valuationCount: number;
  /** Movement since the previous valuation; null when there is nothing to compare. */
  change: number | null;
  reason: AssetReason;
  /** The most recent valuations, newest first. */
  valuations: ValuationItem[];
}

export interface NetWorthChartPoint {
  month: string;
  label: string;
  assets: number;
  liabilities: number;
  cash: number;
  netWorth: number;
}
