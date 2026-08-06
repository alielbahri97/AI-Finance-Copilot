"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Loader2Icon,
  ReceiptTextIcon,
  SearchXIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DataTablePagination,
  SortHeader,
  TABLE_SCROLL_AREA,
  TABLE_STICKY_HEAD,
  useTableSearchParams,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  DEFAULT_SORT_DIRECTION,
  PAGE_SIZE_OPTIONS,
  SORT_DEFAULT_DIRECTION,
  type CategoryOption,
  type SortDirection,
  type TransactionRow,
  type TransactionSortKey,
  type TransactionTotals,
} from "./types";

const UNCATEGORIZED = "uncategorized";

const SORT_LABELS: Record<TransactionSortKey, string> = {
  date: "Date",
  description: "Description",
  category: "Category",
  amount: "Amount",
};

interface TransactionsTableProps {
  transactions: TransactionRow[];
  categories: CategoryOption[];
  currency: string;
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  totals: TransactionTotals;
  sort: TransactionSortKey;
  direction: SortDirection;
  canEdit: boolean;
  hasActiveFilters: boolean;
}

function CategorySelect({
  value,
  categories,
  type,
  disabled,
  onChange,
  ariaLabel,
  placeholder,
  className,
}: {
  value?: string;
  categories: CategoryOption[];
  type?: "INCOME" | "EXPENSE";
  disabled?: boolean;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}) {
  const income = categories.filter((category) => category.type === "INCOME");
  const expense = categories.filter((category) => category.type === "EXPENSE");
  // Show the matching group first for the row's type.
  const groups =
    type === "INCOME"
      ? [{ label: "Income", items: income }, { label: "Expenses", items: expense }]
      : [{ label: "Expenses", items: expense }, { label: "Income", items: income }];

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        className={cn(
          "hover:border-input w-full min-w-36 border-transparent bg-transparent shadow-none",
          className
        )}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNCATEGORIZED}>
          <span className="text-muted-foreground">Uncategorized</span>
        </SelectItem>
        {groups.map(
          (group) =>
            group.items.length > 0 && (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      {category.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            )
        )}
      </SelectContent>
    </Select>
  );
}

export function TransactionsTable({
  transactions,
  categories,
  currency,
  page,
  pageCount,
  pageSize,
  totalCount,
  totals,
  sort,
  direction,
  canEdit,
  hasActiveFilters,
}: TransactionsTableProps) {
  const router = useRouter();
  const setParams = useTableSearchParams();
  const locale = localeForCurrency(currency);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const pageIds = useMemo(() => transactions.map((tx) => tx.id), [transactions]);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedOffPage = selected.size - pageIds.filter((id) => selected.has(id)).length;

  function toggleAll() {
    setSelected((prev) => {
      if (pageIds.every((id) => prev.has(id))) {
        const next = new Set(prev);
        pageIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applySort(column: TransactionSortKey) {
    const nextDirection: SortDirection =
      sort === column
        ? direction === "asc"
          ? "desc"
          : "asc"
        : SORT_DEFAULT_DIRECTION[column];
    const isDefault = column === DEFAULT_SORT && nextDirection === DEFAULT_SORT_DIRECTION;
    setParams({
      sort: isDefault ? null : column,
      dir: isDefault ? null : nextDirection,
      page: null,
    });
  }

  async function setRowCategory(id: string, value: string) {
    setBusyId(id);
    try {
      const response = await fetch(`/api/transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: value === UNCATEGORIZED ? null : value }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not update category", { description: body?.error ?? "Try again." });
        return;
      }
      const learned = body?.learnedRule as
        | { pattern?: string; categoryName?: string }
        | null
        | undefined;
      if (learned?.categoryName) {
        // Naming the pattern is the point: the user needs to know what we
        // learned, so they can go and fix it on /rules if it is too broad.
        toast.success(
          learned.pattern
            ? `Always categorizing "${learned.pattern}" as ${learned.categoryName}`
            : `We'll categorize similar transactions as ${learned.categoryName} going forward`,
          { description: "Rules like this always take precedence over AI suggestions." }
        );
      }
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRow(id: string) {
    setBusyId(id);
    try {
      const response = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not delete transaction", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success("Transaction deleted");
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function bulkAction(body: Record<string, unknown>, successMessage: (count: number) => string) {
    setBulkBusy(true);
    try {
      const response = await fetch("/api/transactions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, ids: [...selected] }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Bulk action failed", { description: payload?.error ?? "Try again." });
        return;
      }
      toast.success(successMessage(payload?.affected ?? selected.size));
      const learned = payload?.learnedRules as
        | { pattern?: string; categoryName?: string }[]
        | null
        | undefined;
      const first = learned?.[0];
      if (first?.categoryName) {
        toast.success(
          first.pattern
            ? `Always categorizing "${first.pattern}" as ${first.categoryName}${learned && learned.length > 1 ? ` (+${learned.length - 1} more)` : ""}`
            : `We'll categorize similar transactions as ${first.categoryName} going forward`,
          { description: "Rules like this always take precedence over AI suggestions." }
        );
      }
      setSelected(new Set());
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBulkBusy(false);
    }
  }

  if (transactions.length === 0) {
    return hasActiveFilters ? (
      <EmptyState
        icon={SearchXIcon}
        title="Nothing matches these filters"
        description="Widen the date range, pick another category, or start over."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/transactions">Clear filters</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={ReceiptTextIcon}
        title="No transactions yet"
        description="Import a bank statement to bring in months of history at once, or add a single entry by hand."
        action={
          canEdit ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" asChild>
                <Link href="/import">Import CSV</Link>
              </Button>
              <TransactionDialog categories={categories} />
            </div>
          ) : undefined
        }
      />
    );
  }

  const amountClass = (type: TransactionRow["type"]) =>
    cn("font-semibold tabular-nums", type === "INCOME" ? "text-success" : "text-foreground");

  const deleteDialog = (tx: TransactionRow) => (
    <ConfirmDialog
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive size-8"
          disabled={busyId === tx.id}
          aria-label={`Delete ${tx.description}`}
        >
          {busyId === tx.id ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
        </Button>
      }
      title={`Delete “${tx.description}”?`}
      description={`The ${formatCurrency(tx.amount, currency, locale)} entry from ${formatDate(tx.date, locale)} goes for good. Budget and report totals will recalculate without it.`}
      confirmLabel="Delete transaction"
      onConfirm={() => deleteRow(tx.id)}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="bg-accent/60 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
          <span className="text-sm font-medium">
            {selected.size} selected
            {selectedOffPage > 0 && (
              <span className="text-muted-foreground font-normal">
                {" "}
                · {selectedOffPage} on other pages
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Set category:</span>
            <div className="w-44">
              <CategorySelect
                placeholder="Choose…"
                categories={categories}
                onChange={(value) =>
                  bulkAction(
                    { action: "setCategory", categoryId: value === UNCATEGORIZED ? null : value },
                    (count) => `Category updated on ${count} transactions`
                  )
                }
                disabled={bulkBusy}
                ariaLabel="Set category for selected transactions"
              />
            </div>
          </div>
          <ConfirmDialog
            trigger={
              <Button variant="destructive" size="sm" disabled={bulkBusy}>
                {bulkBusy ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                Delete
              </Button>
            }
            title={`Delete ${selected.size} transaction${selected.size === 1 ? "" : "s"}?`}
            description={
              selectedOffPage > 0
                ? `${selectedOffPage} of them sit on other pages, so you cannot see them all right now. Every one goes for good, and budget and report totals will recalculate without them.`
                : "They go for good, and budget and report totals will recalculate without them."
            }
            confirmLabel={`Delete ${selected.size} transaction${selected.size === 1 ? "" : "s"}`}
            onConfirm={() =>
              bulkAction({ action: "delete" }, (count) => `Deleted ${count} transactions`)
            }
          />
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 sm:hidden">
        <Checkbox
          checked={allSelected}
          onCheckedChange={toggleAll}
          aria-label="Select all on this page"
        />
        <Select value={sort} onValueChange={(value) => applySort(value as TransactionSortKey)}>
          <SelectTrigger size="sm" className="flex-1" aria-label="Sort transactions by">
            <span className="text-muted-foreground">Sort by</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as TransactionSortKey[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SORT_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => applySort(sort)}
          aria-label={`Sorted ${direction === "asc" ? "ascending" : "descending"}, switch direction`}
        >
          {direction === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:hidden">
        {transactions.map((tx) => (
          <div
            key={tx.id}
            data-state={selected.has(tx.id) ? "selected" : undefined}
            className="data-[state=selected]:bg-muted flex flex-col gap-2 rounded-lg border p-3"
          >
            <div className="flex items-start gap-2.5">
              <Checkbox
                checked={selected.has(tx.id)}
                onCheckedChange={() => toggleOne(tx.id)}
                aria-label={`Select ${tx.description}`}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{tx.description}</span>
                  {tx.invoiceId && (
                    <Link
                      href={`/invoices/${tx.invoiceId}`}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      aria-label={`Open linked invoice${tx.invoiceVendor ? ` from ${tx.invoiceVendor}` : ""}`}
                    >
                      <ReceiptTextIcon className="size-3.5" />
                    </Link>
                  )}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {formatDate(tx.date, locale)}
                  {tx.counterparty ? ` · ${tx.counterparty}` : ""}
                </p>
              </div>
              <span className={cn(amountClass(tx.type), "text-sm")}>
                {tx.type === "INCOME" ? "+" : "-"}
                {formatCurrency(tx.amount, currency, locale)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <CategorySelect
                  value={tx.categoryId ?? UNCATEGORIZED}
                  categories={categories}
                  type={tx.type}
                  disabled={busyId === tx.id}
                  onChange={(value) => setRowCategory(tx.id, value)}
                  ariaLabel={`Category for ${tx.description}`}
                  className="border-input min-w-0"
                />
              </div>
              {deleteDialog(tx)}
            </div>
          </div>
        ))}
      </div>

      <div className={cn("hidden sm:block", TABLE_SCROLL_AREA)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={cn(TABLE_STICKY_HEAD, "w-10")}>
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all on this page"
                />
              </TableHead>
              <SortHeader
                column="date"
                label={SORT_LABELS.date}
                sort={sort}
                direction={direction}
                onSort={applySort}
              />
              <SortHeader
                column="description"
                label={SORT_LABELS.description}
                sort={sort}
                direction={direction}
                onSort={applySort}
              />
              <TableHead className={cn(TABLE_STICKY_HEAD, "hidden lg:table-cell")}>
                Counterparty
              </TableHead>
              <SortHeader
                column="category"
                label={SORT_LABELS.category}
                sort={sort}
                direction={direction}
                onSort={applySort}
              />
              <SortHeader
                column="amount"
                label={SORT_LABELS.amount}
                sort={sort}
                direction={direction}
                onSort={applySort}
                align="right"
                className="text-right"
              />
              <TableHead className={cn(TABLE_STICKY_HEAD, "w-12")} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((tx) => (
              <TableRow key={tx.id} data-state={selected.has(tx.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(tx.id)}
                    onCheckedChange={() => toggleOne(tx.id)}
                    aria-label={`Select ${tx.description}`}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatDate(tx.date, locale)}
                </TableCell>
                <TableCell className="max-w-56 font-medium">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate" title={tx.description}>
                      {tx.description}
                    </span>
                    {tx.invoiceId && (
                      <Link
                        href={`/invoices/${tx.invoiceId}`}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        title={`Linked invoice${tx.invoiceVendor ? `: ${tx.invoiceVendor}` : ""}`}
                        aria-label={`Open linked invoice${tx.invoiceVendor ? ` from ${tx.invoiceVendor}` : ""}`}
                      >
                        <ReceiptTextIcon className="size-3.5" />
                      </Link>
                    )}
                  </span>
                </TableCell>
                <TableCell
                  className="text-muted-foreground hidden max-w-40 truncate lg:table-cell"
                  title={tx.counterparty ?? undefined}
                >
                  {tx.counterparty ?? "—"}
                </TableCell>
                <TableCell className="min-w-40">
                  <CategorySelect
                    value={tx.categoryId ?? UNCATEGORIZED}
                    categories={categories}
                    type={tx.type}
                    disabled={busyId === tx.id}
                    onChange={(value) => setRowCategory(tx.id, value)}
                    ariaLabel={`Category for ${tx.description}`}
                  />
                </TableCell>
                <TableCell className={cn("text-right", amountClass(tx.type))}>
                  {tx.type === "INCOME" ? "+" : "-"}
                  {formatCurrency(tx.amount, currency, locale)}
                </TableCell>
                <TableCell>{deleteDialog(tx)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        defaultPageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        noun="transaction"
        locale={locale}
        summary={
          <span className="tabular-nums">
            Income{" "}
            <span className="text-success font-medium">
              {formatCurrency(totals.income, currency, locale)}
            </span>
            {" · "}
            Expenses{" "}
            <span className="text-foreground font-medium">
              {formatCurrency(totals.expenses, currency, locale)}
            </span>
            {" · "}
            Net{" "}
            <span
              className={cn("font-medium", totals.net < 0 ? "text-destructive" : "text-success")}
            >
              {formatCurrency(totals.net, currency, locale)}
            </span>
          </span>
        }
      />
    </div>
  );
}
