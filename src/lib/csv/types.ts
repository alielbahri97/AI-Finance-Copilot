export type ColumnRole =
  | "date"
  | "description"
  | "amount"
  | "debit"
  | "credit"
  | "balance"
  | "counterparty"
  | "currency"
  | "ignore";

/** How numbers are written: US `1,234.56` vs European `1.234,56`. */
export type NumberFormat = "us" | "eu";

/** Date layouts commonly found in bank exports. */
export type DateFormat = "ymd" | "dmy" | "mdy" | "compact";

export interface ParsedCsv {
  /** Header row values, or null when the file has no header row. */
  headers: string[] | null;
  /** Data rows (header excluded). */
  rows: string[][];
  delimiter: string;
  columnCount: number;
}

/**
 * Maps CSV column indexes to transaction fields. Either `amount` (signed) or
 * the `debit`/`credit` pair must be present.
 */
export interface ColumnMapping {
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  counterparty: number | null;
  /** Optional ISO currency column (EUR, USD, …). */
  currency: number | null;
  numberFormat: NumberFormat;
  dateFormat: DateFormat;
}

/** Currency detected from a statement's Currency column and/or amount symbols. */
export interface StatementCurrencyInfo {
  /** Majority / sole currency code, or null when unknown. */
  code: string | null;
  /** True when more than one distinct currency appears in the file. */
  mixed: boolean;
  /** Distinct currency codes found (uppercase ISO-ish). */
  codes: string[];
  /** Column index used for detection, when a Currency column was mapped. */
  columnIndex: number | null;
}

export interface NormalizedRow {
  date: string; // ISO yyyy-mm-dd
  description: string;
  counterparty: string | null;
  /** Absolute amount, always positive. */
  amount: number;
  type: "INCOME" | "EXPENSE";
  balance: number | null;
}

export interface RowError {
  rowNumber: number;
  message: string;
}
