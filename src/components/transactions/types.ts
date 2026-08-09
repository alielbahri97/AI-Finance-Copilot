export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

/**
 * How many largest uncategorized transactions a teach / categorize visit loads.
 * Kept small so a session feels like ~5 minutes, not an endless backlog.
 */
export const TEACH_SESSION_SIZE = 8;

export type TransactionSortKey = "date" | "description" | "category" | "amount";
export type SortDirection = "asc" | "desc";

export const DEFAULT_SORT: TransactionSortKey = "date";
export const DEFAULT_SORT_DIRECTION: SortDirection = "desc";

/** Direction a column starts in when you first sort by it. */
export const SORT_DEFAULT_DIRECTION: Record<TransactionSortKey, SortDirection> = {
  date: "desc",
  description: "asc",
  category: "asc",
  amount: "desc",
};

/** Totals for the whole filtered set, not just the page on screen. */
export interface TransactionTotals {
  income: number;
  expenses: number;
  net: number;
}

export interface CategoryOption {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  color: string;
}

export interface BatchOption {
  id: string;
  fileName: string;
  createdAt: string;
  transactionCount: number;
}

export interface TransactionRow {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  description: string;
  counterparty: string | null;
  date: string;
  importBatchId: string | null;
  /** Linked invoice, when this transaction settles one. */
  invoiceId: string | null;
  invoiceVendor: string | null;
}
