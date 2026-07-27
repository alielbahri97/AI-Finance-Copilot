"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, FileTextIcon, Link2Icon, Loader2Icon, UndoIcon } from "lucide-react";
import { toast } from "sonner";

import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InvoiceDto } from "@/lib/invoices/serialize";
import { formatCurrency, formatDate } from "@/lib/utils";

interface InvoicesTableProps {
  invoices: InvoiceDto[];
  hasFilters: boolean;
}

export function InvoicesTable({ invoices, hasFilters }: InvoicesTableProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

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

  if (invoices.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
        <FileTextIcon className="size-8 opacity-50" />
        <p className="font-medium">{hasFilters ? "No invoices match your filters" : "No invoices yet"}</p>
        <p>{hasFilters ? "Try changing or clearing the filters." : "Upload a PDF or photo to get started."}</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vendor</TableHead>
          <TableHead className="hidden md:table-cell">Number</TableHead>
          <TableHead className="hidden sm:table-cell">Date</TableHead>
          <TableHead>Due</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-24 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow
            key={invoice.id}
            className="cursor-pointer"
            onClick={() => router.push(`/invoices/${invoice.id}`)}
          >
            <TableCell className="max-w-48">
              <div className="flex items-center gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{invoice.vendor || "Unknown vendor"}</p>
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
            <TableCell className="text-muted-foreground hidden sm:table-cell">
              {invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "—"}
            </TableCell>
            <TableCell
              className={
                invoice.derivedStatus === "OVERDUE"
                  ? "text-destructive font-medium"
                  : "text-muted-foreground"
              }
            >
              {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {formatCurrency(invoice.total, invoice.currency)}
            </TableCell>
            <TableCell>
              <InvoiceStatusBadge status={invoice.derivedStatus} />
            </TableCell>
            <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
              {busyId === invoice.id ? (
                <Loader2Icon className="text-muted-foreground ml-auto size-4 animate-spin" />
              ) : invoice.status === "PAID" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground h-7"
                  onClick={() => setStatus(invoice, "UNPAID")}
                >
                  <UndoIcon />
                  Unpaid
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-success h-7"
                  onClick={() => setStatus(invoice, "PAID")}
                >
                  <CheckIcon />
                  Paid
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
