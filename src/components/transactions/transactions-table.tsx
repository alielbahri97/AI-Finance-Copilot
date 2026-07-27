"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  ReceiptTextIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { CategoryOption, TransactionRow } from "./types";

const UNCATEGORIZED = "uncategorized";

interface TransactionsTableProps {
  transactions: TransactionRow[];
  categories: CategoryOption[];
  currency: string;
  page: number;
  pageCount: number;
  totalCount: number;
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
}: {
  value?: string;
  categories: CategoryOption[];
  type?: "INCOME" | "EXPENSE";
  disabled?: boolean;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
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
        className="hover:border-input w-full min-w-36 border-transparent bg-transparent shadow-none"
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
  totalCount,
  hasActiveFilters,
}: TransactionsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const pageIds = useMemo(() => transactions.map((tx) => tx.id), [transactions]);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

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

  function goToPage(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (target <= 1) params.delete("page");
    else params.set("page", String(target));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function setRowCategory(id: string, value: string) {
    setBusyId(id);
    try {
      const response = await fetch(`/api/transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: value === UNCATEGORIZED ? null : value }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not update category", { description: body?.error ?? "Try again." });
        return;
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
      setSelected(new Set());
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBulkBusy(false);
    }
  }

  if (transactions.length === 0) {
    return (
      <div className="text-muted-foreground py-12 text-center text-sm">
        {hasActiveFilters
          ? "No transactions match your filters."
          : "No transactions yet. Add one manually or import a bank statement."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="bg-accent/60 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
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
          <Button
            variant="destructive"
            size="sm"
            disabled={bulkBusy}
            onClick={() =>
              bulkAction({ action: "delete" }, (count) => `Deleted ${count} transactions`)
            }
          >
            {bulkBusy ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleAll}
                aria-label="Select all on this page"
              />
            </TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="hidden md:table-cell">Counterparty</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="w-12" />
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
                {formatDate(tx.date)}
              </TableCell>
              <TableCell className="max-w-56 font-medium">
                <span className="flex items-center gap-1.5">
                  <span className="truncate" title={tx.description}>
                    {tx.description}
                  </span>
                  {tx.invoiceId && (
                    <Link
                      href={`/invoices/${tx.invoiceId}`}
                      className="text-success hover:text-success/80 shrink-0"
                      title={`Linked invoice${tx.invoiceVendor ? `: ${tx.invoiceVendor}` : ""}`}
                      aria-label={`Open linked invoice${tx.invoiceVendor ? ` from ${tx.invoiceVendor}` : ""}`}
                    >
                      <ReceiptTextIcon className="size-3.5" />
                    </Link>
                  )}
                </span>
              </TableCell>
              <TableCell
                className="text-muted-foreground hidden max-w-40 truncate md:table-cell"
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
              <TableCell
                className={cn(
                  "text-right font-semibold tabular-nums",
                  tx.type === "INCOME" ? "text-success" : "text-foreground"
                )}
              >
                {tx.type === "INCOME" ? "+" : "-"}
                {formatCurrency(tx.amount, currency)}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive size-8"
                  onClick={() => deleteRow(tx.id)}
                  disabled={busyId === tx.id}
                  aria-label={`Delete ${tx.description}`}
                >
                  {busyId === tx.id ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <span className="text-muted-foreground text-sm">
          {totalCount.toLocaleString()} transaction{totalCount === 1 ? "" : "s"}
          {pageCount > 1 && ` • page ${page} of ${pageCount}`}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeftIcon />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => goToPage(page + 1)}
            >
              Next
              <ChevronRightIcon />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
