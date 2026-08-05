export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

export type InvoiceSortKey = "due" | "date" | "vendor" | "amount";
export type SortDirection = "asc" | "desc";

/** Payables work off the due date, so that is what the list opens on. */
export const DEFAULT_SORT: InvoiceSortKey = "due";
export const DEFAULT_SORT_DIRECTION: SortDirection = "asc";

export const SORT_DEFAULT_DIRECTION: Record<InvoiceSortKey, SortDirection> = {
  due: "asc",
  date: "desc",
  vendor: "asc",
  amount: "desc",
};
