"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, Trash2Icon, UndoIcon } from "lucide-react";
import { toast } from "@/lib/toast";

import { RemindCustomerDialog } from "@/components/invoices/remind-customer-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { InvoiceDto } from "@/lib/invoices/serialize";

interface InvoiceActionsProps {
  invoice: InvoiceDto;
}

/** Quick actions for the detail header: mark paid/unpaid and delete. */
export function InvoiceActions({ invoice }: InvoiceActionsProps) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  async function setStatus(status: "PAID" | "UNPAID") {
    setIsBusy(true);
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
      setIsBusy(false);
    }
  }

  async function remove() {
    setIsBusy(true);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not delete invoice", { description: body?.error });
        return;
      }
      toast.success("Invoice deleted");
      router.push("/invoices");
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Chasing money is only a thing for invoices we issued and nobody paid. */}
      {invoice.direction === "RECEIVABLE" && invoice.status === "UNPAID" && (
        <RemindCustomerDialog invoice={invoice} />
      )}
      {invoice.status === "PAID" ? (
        <Button size="sm" variant="outline" onClick={() => setStatus("UNPAID")} disabled={isBusy}>
          <UndoIcon />
          Mark unpaid
        </Button>
      ) : (
        <Button size="sm" onClick={() => setStatus("PAID")} disabled={isBusy}>
          <CheckIcon />
          Mark paid
        </Button>
      )}
      <ConfirmDialog
        trigger={
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={isBusy}
          >
            <Trash2Icon />
            Delete
          </Button>
        }
        title="Delete this invoice?"
        description="The invoice, its line items and the stored document will be removed permanently."
        confirmLabel="Delete invoice"
        onConfirm={remove}
      />
    </div>
  );
}
