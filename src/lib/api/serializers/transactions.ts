/**
 * Query parsing and wire shaping for `GET /api/transactions`.
 *
 * The filter, sort and pagination semantics are the transactions page's, param
 * for param — `SORT_DEFAULT_DIRECTION` and `PAGE_SIZE_OPTIONS` are imported
 * from the page's own module rather than restated, so the two cannot drift.
 *
 * One deliberate difference from the page: the page silently ignores a
 * malformed value (a bad date, a page size it does not offer) because a URL is
 * hand-editable and a broken filter should not break the screen. An API client
 * sending `size=7` has a bug, so everything except `type` is validated and
 * answered with 400. `type` keeps the page's tolerance because an unrecognised
 * value there means "no type filter", which is a real state the UI relies on.
 */

import { z } from "zod";

import { money, timestamp, type MoneyString, type TimestampString } from "@/lib/api/wire";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  PAGE_SIZE_OPTIONS,
  SORT_DEFAULT_DIRECTION,
  type SortDirection,
  type TransactionSortKey,
} from "@/components/transactions/types";
import type { Prisma } from "@/generated/prisma/client";

/** The literal `category` value that means "no category at all". */
export const UNCATEGORIZED = "uncategorized";

const SORT_KEYS = ["date", "description", "category", "amount"] as const;

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be formatted YYYY-MM-DD");

const amountParam = z.coerce
  .number({ error: "Amount filters must be numbers" })
  .min(0, "Amount filters cannot be negative");

export const transactionQuerySchema = z.object({
  q: z.string().optional(),
  // Anything other than the two enum members means "every type", exactly as
  // the page treats it.
  type: z.enum(["INCOME", "EXPENSE"]).optional().catch(undefined),
  category: z.string().optional(),
  batch: z.string().optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
  min: amountParam.optional(),
  max: amountParam.optional(),
  sort: z.enum(SORT_KEYS).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce
    .number({ error: "Page must be a whole number" })
    .int("Page must be a whole number")
    .min(1, "Page starts at 1")
    .optional(),
  size: z.coerce
    .number({ error: "Page size must be 25, 50 or 100" })
    .refine(
      (value) => (PAGE_SIZE_OPTIONS as readonly number[]).includes(value),
      "Page size must be 25, 50 or 100"
    )
    .optional(),
});

export type TransactionQuery = z.infer<typeof transactionQuerySchema>;

const QUERY_KEYS = [
  "q",
  "type",
  "category",
  "batch",
  "from",
  "to",
  "min",
  "max",
  "sort",
  "dir",
  "page",
  "size",
] as const;

/**
 * Collects the recognised params, dropping blanks.
 *
 * `?page=` is an absent page rather than page zero: the page reaches the same
 * conclusion through `Number("") || 1`, and coercing "" to 0 here would 400 a
 * URL the web app produces routinely when a filter is cleared.
 */
export function readTransactionParams(url: URL): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null && value.trim() !== "") raw[key] = value;
  }
  return raw;
}

/** UTC start of day, so a filter means the same thing in every timezone. */
function startOfDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

export function buildTransactionWhere(
  workspaceId: string,
  query: TransactionQuery
): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { workspaceId };

  const q = query.q?.trim();
  if (q) {
    where.OR = [
      { description: { contains: q, mode: "insensitive" } },
      { counterparty: { contains: q, mode: "insensitive" } },
    ];
  }
  if (query.type) where.type = query.type;
  if (query.category === UNCATEGORIZED) where.categoryId = null;
  else if (query.category) where.categoryId = query.category;
  if (query.batch) where.importBatchId = query.batch;
  if (query.from || query.to) {
    where.date = {
      ...(query.from && { gte: startOfDay(query.from) }),
      ...(query.to && { lte: endOfDay(query.to) }),
    };
  }
  if (query.min !== undefined || query.max !== undefined) {
    where.amount = {
      ...(query.min !== undefined && { gte: query.min }),
      ...(query.max !== undefined && { lte: query.max }),
    };
  }

  return where;
}

/**
 * The sort key in force. An explicit `sort` wins; without one, a filter on the
 * uncategorized bucket leads with the biggest amounts, because that is the
 * order in which labelling transactions is worth the effort.
 */
export function resolveSort(query: TransactionQuery): TransactionSortKey {
  if (query.sort) return query.sort;
  return query.category === UNCATEGORIZED ? "amount" : DEFAULT_SORT;
}

/** An explicit `dir` wins; otherwise the column's own starting direction. */
export function resolveDirection(
  query: TransactionQuery,
  sort: TransactionSortKey
): SortDirection {
  return query.dir ?? SORT_DEFAULT_DIRECTION[sort];
}

/**
 * Sorting happens in the query, never on the page that was fetched, and every
 * column falls back to date so the order stays stable across pages.
 */
export function buildTransactionOrderBy(
  sort: TransactionSortKey,
  direction: SortDirection
): Prisma.TransactionOrderByWithRelationInput[] {
  switch (sort) {
    case "amount":
      return [{ amount: direction }, { date: "desc" }, { createdAt: "desc" }];
    case "description":
      return [{ description: direction }, { date: "desc" }, { createdAt: "desc" }];
    case "category":
      return [{ category: { name: direction } }, { date: "desc" }, { createdAt: "desc" }];
    default:
      return [{ date: direction }, { createdAt: direction }];
  }
}

export function resolvePageSize(query: TransactionQuery): number {
  return query.size ?? DEFAULT_PAGE_SIZE;
}

/** Clamps the requested page into the range the filtered set actually has. */
export function resolvePaging(
  query: TransactionQuery,
  totalCount: number,
  pageSize: number
): { page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  return { page: Math.min(query.page ?? 1, pageCount), pageCount };
}

export interface TransactionRowInput {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: { toFixed(digits: number): string } | number | string;
  categoryId: string | null;
  category: { name: string; color: string } | null;
  description: string;
  counterparty: string | null;
  date: Date;
  createdAt: Date;
  importBatchId: string | null;
}

export interface SerializedTransaction {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: MoneyString;
  /** The workspace currency the amount is denominated in. */
  currency: string;
  category: { id: string; name: string; color: string } | null;
  description: string;
  counterparty: string | null;
  date: TimestampString;
  createdAt: TimestampString;
  importBatchId: string | null;
}

export function serializeTransaction(
  row: TransactionRowInput,
  currency: string
): SerializedTransaction {
  return {
    id: row.id,
    type: row.type,
    amount: money(row.amount),
    currency,
    category:
      row.categoryId && row.category
        ? { id: row.categoryId, name: row.category.name, color: row.category.color }
        : null,
    description: row.description,
    counterparty: row.counterparty,
    date: timestamp(row.date),
    createdAt: timestamp(row.createdAt),
    importBatchId: row.importBatchId,
  };
}

export interface BatchRowInput {
  id: string;
  fileName: string;
  createdAt: Date;
  _count: { transactions: number };
}

export interface SerializedBatch {
  id: string;
  fileName: string;
  createdAt: TimestampString;
  transactionCount: number;
}

export function serializeBatch(row: BatchRowInput): SerializedBatch {
  return {
    id: row.id,
    fileName: row.fileName,
    createdAt: timestamp(row.createdAt),
    transactionCount: row._count.transactions,
  };
}

/** A `groupBy(["type"])` result with summed amounts. */
export interface TypeSumRow {
  type: "INCOME" | "EXPENSE";
  _sum: { amount: { toFixed(digits: number): string } | number | string | null };
}

export interface SerializedTotals {
  income: MoneyString;
  expenses: MoneyString;
  net: MoneyString;
}

/**
 * Totals for the whole filtered set. The rows come from a `groupBy` over the
 * same `where` the list uses, so narrowing to a category answers "how much did
 * this cost me" rather than "how much of it is on this page".
 */
export function serializeTotals(sums: TypeSumRow[]): SerializedTotals {
  // Routed through `money` before any arithmetic: that is the one path that
  // knows how to read a Decimal exactly, and it fixes the scale first, so the
  // subtraction below is on two values that are already whole cents.
  const sumFor = (type: "INCOME" | "EXPENSE"): number =>
    Number(money(sums.find((entry) => entry.type === type)?._sum.amount ?? 0));
  const income = sumFor("INCOME");
  const expenses = sumFor("EXPENSE");
  return { income: money(income), expenses: money(expenses), net: money(income - expenses) };
}
