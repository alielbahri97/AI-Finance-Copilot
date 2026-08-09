"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  FileTextIcon,
  Link2Icon,
  Loader2Icon,
  SearchXIcon,
  UndoIcon,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { UploadInvoice } from "@/components/invoices/upload-invoice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTablePagination,
  SortHeader,
  TABLE_SCROLL_AREA,
  TABLE_STICKY_HEAD,
  useTableSearchParams,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyText } from "@/components/ui/money-text";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InvoiceDto } from "@/lib/invoices/serialize";
import { cn, formatDate } from "@/lib/utils";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  DEFAULT_SORT_DIRECTION,
  PAGE_SIZE_OPTIONS,
  SORT_DEFAULT_DIRECTION,
  type InvoiceSortKey,
  type SortDirection,
} from "./types";

const SORT_LABELS: Record<InvoiceSortKey, string> = {
  vendor: "Vendor",
  date: "Date",
  due: "Due",
  amount: "Total",
};

interface InvoicesTableProps {
  invoices: InvoiceDto[];
  hasFilters: boolean;
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  sort: InvoiceSortKey;
  direction: SortDirection;
  canEdit: boolean;
  /**
   * The reader's locale, not the invoice's: every row carries its own
   * currency, but the grouping and date order are the workspace's throughout.
   */
  locale: string;
}

export function InvoicesTable({
  invoices,
  hasFilters,
  page,
  pageCount,
  pageSize,
  totalCount,
  sort,
  direction,
  canEdit,
  locale,
}: InvoicesTableProps) {
  const router = useRouter();
  const setParams = useTableSearchParams();
  const [busyId, setBusyId] = useState<string | null>(null);

  function applySort(column: InvoiceSortKey) {
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

  async function setStatus(invoice: InvoiceDto, status: "PAID" | "UNPAID") {
    setBusyId(invoice.id);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not update invoice", { description: body?.error });
        return;
      }
      toast.success(status === "PAID" ? "Marked as paid" : "Marked as unpaid");
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  function statusAction(invoice: InvoiceDto) {
    if (busyId === invoice.id) {
      return <Loader2Icon className="text-muted-foreground size-4 animate-spin" />;
    }
    if (invoice.status === "PAID") {
      return (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground h-7"
          onClick={() => setStatus(invoice, "UNPAID")}
        >
          <UndoIcon />
          Unpaid
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-success h-7"
        onClick={() => setStatus(invoice, "PAID")}
      >
        <CheckIcon />
        Paid
      </Button>
    );
  }

  if (invoices.length === 0) {
    return hasFilters ? (
      <EmptyState
        icon={SearchXIcon}
        title="No invoices match these filters"
        description="Try a wider date range, another status, or a shorter vendor search."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/invoices">Clear filters</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={FileTextIcon}
        title="No invoices yet"
        description="Upload a PDF or a photo of a bill and we extract the vendor, dates and totals for you to check."
        action={canEdit ? <UploadInvoice /> : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:hidden">
        {invoices.map((invoice) => (
          <div
            key={invoice.id}
            className="flex flex-col gap-2.5 rounded-xl border border-border/60 p-3.5 shadow-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/invoices/${invoice.id}`}
                  className="focus-visible:ring-ring block truncate text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                >
                  {invoice.vendor || "Unknown vendor"}
                </Link>
                <p className="text-muted-foreground truncate text-xs">
                  {invoice.dueDate
                    ? `Due ${formatDate(invoice.dueDate, locale)}`
                    : invoice.invoiceDate
                      ? formatDate(invoice.invoiceDate, locale)
                      : invoice.fileName}
                </p>
              </div>
              <MoneyText
                amount={invoice.total}
                currency={invoice.currency}
                locale={locale}
                size="md"
                className="shrink-0"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <InvoiceStatusBadge status={invoice.derivedStatus} />
                {invoice.transaction ? (
                  <Link2Icon
                    className="text-success size-3.5 shrink-0"
                    aria-label="Linked to a transaction"
                  />
                ) : null}
              </div>
              <div onClick={(event) => event.stopPropagation()}>{statusAction(invoice)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className={cn("hidden sm:block", TABLE_SCROLL_AREA)}>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader
                column="vendor"
                label={SORT_LABELS.vendor}
                sort={sort}
                direction={direction}
                onSort={applySort}
              />
              <TableHead className={cn(TABLE_STICKY_HEAD, "hidden md:table-cell")}>
                Number
              </TableHead>
              <SortHeader
                column="date"
                label={SORT_LABELS.date}
                sort={sort}
                direction={direction}
                onSort={applySort}
                className="hidden lg:table-cell"
              />
              <SortHeader
                column="due"
                label={SORT_LABELS.due}
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
              <TableHead className={TABLE_STICKY_HEAD}>Status</TableHead>
              <TableHead className={cn(TABLE_STICKY_HEAD, "w-24 text-right")}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id} className="relative">
                <TableCell className="max-w-48">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="focus-visible:ring-ring block rounded-sm after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <span className="block truncate font-medium">
                          {invoice.vendor || "Unknown vendor"}
                        </span>
                      </Link>
                      <p className="text-muted-foreground truncate text-xs">{invoice.fileName}</p>
                    </div>
                    {invoice.direction === "RECEIVABLE" && (
                      <Badge variant="outline" className="hidden shrink-0 text-xs lg:inline-flex">
                        Receivable
                      </Badge>
                    )}
                    {invoice.transaction && (
                      <Link2Icon
                        className="text-success size-3.5 shrink-0"
                        aria-label="Linked to a transaction"
                      />
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground hidden md:table-cell">
                  {invoice.invoiceNumber ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground hidden lg:table-cell">
                  {invoice.invoiceDate ? formatDate(invoice.invoiceDate, locale) : "—"}
                </TableCell>
                <TableCell
                  className={
                    invoice.derivedStatus === "OVERDUE"
                      ? "text-destructive font-medium"
                      : "text-muted-foreground"
                  }
                >
                  {invoice.dueDate ? formatDate(invoice.dueDate, locale) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <MoneyText
                    amount={invoice.total}
                    currency={invoice.currency}
                    locale={locale}
                    size="md"
                  />
                </TableCell>
                <TableCell>
                  <InvoiceStatusBadge status={invoice.derivedStatus} />
                </TableCell>
                <TableCell
                  className="relative z-10 text-right"
                  onClick={(event) => event.stopPropagation()}
                >
                  {statusAction(invoice)}
                </TableCell>
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
        noun="invoice"
        locale={locale}
      />
    </div>
  );
}
