"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, Loader2Icon, Trash2Icon, UndoIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { InvoiceDto } from "@/lib/invoices/serialize";

interface InvoiceActionsProps {
  invoice: InvoiceDto;
}

/** Quick actions for the detail header: mark paid/unpaid and delete. */
export function InvoiceActions({ invoice }: InvoiceActionsProps) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      setConfirmDelete(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
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
      <Button
        size="sm"
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirmDelete(true)}
        disabled={isBusy}
      >
        <Trash2Icon />
        Delete
      </Button>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this invoice?</DialogTitle>
            <DialogDescription>
              The invoice, its line items and the stored document will be removed permanently.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={isBusy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={isBusy}>
              {isBusy && <Loader2Icon className="animate-spin" />}
              Delete invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
