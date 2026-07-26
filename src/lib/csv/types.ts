export type ColumnRole =
  | "date"
  | "description"
  | "amount"
  | "debit"
  | "credit"
  | "balance"
  | "counterparty"
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
  numberFormat: NumberFormat;
  dateFormat: DateFormat;
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
