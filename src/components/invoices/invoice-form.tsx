"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { InvoiceDto } from "@/lib/invoices/serialize";

interface LineItemState {
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
}

interface InvoiceFormProps {
  invoice: InvoiceDto;
}

function toLineState(invoice: InvoiceDto): LineItemState[] {
  return invoice.lineItems.map((item) => ({
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    total: String(item.total),
  }));
}

/**
 * Editable review form for an invoice's extracted fields and line items.
 * Saving a DRAFT confirms the review and moves the invoice to UNPAID.
 */
export function InvoiceForm({ invoice }: InvoiceFormProps) {
  const router = useRouter();
  const [vendor, setVendor] = useState(invoice.vendor);
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate ?? "");
  const [dueDate, setDueDate] = useState(invoice.dueDate ?? "");
  const [currency, setCurrency] = useState(invoice.currency);
  const [subtotal, setSubtotal] = useState(invoice.subtotal !== null ? String(invoice.subtotal) : "");
  const [vatRate, setVatRate] = useState(invoice.vatRate !== null ? String(invoice.vatRate) : "");
  const [vatAmount, setVatAmount] = useState(
    invoice.vatAmount !== null ? String(invoice.vatAmount) : ""
  );
  const [total, setTotal] = useState(String(invoice.total));
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [lineItems, setLineItems] = useState<LineItemState[]>(toLineState(invoice));
  const [isSaving, setIsSaving] = useState(false);

  function updateItem(index: number, patch: Partial<LineItemState>) {
    setLineItems((items) =>
      items.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, ...patch };
        // Recompute the row total when qty/price change (keeps it editable).
        if (patch.quantity !== undefined || patch.unitPrice !== undefined) {
          const quantity = Number(next.quantity);
          const unitPrice = Number(next.unitPrice);
          if (!Number.isNaN(quantity) && !Number.isNaN(unitPrice)) {
            next.total = String(Math.round(quantity * unitPrice * 100) / 100);
          }
        }
        return next;
      })
    );
  }

  const numericOk = (value: string) => value === "" || !Number.isNaN(Number(value));
  const formValid =
    vendor.trim().length > 0 &&
    total !== "" &&
    Number(total) >= 0 &&
    /^[A-Za-z]{3}$/.test(currency.trim()) &&
    [subtotal, vatRate, vatAmount].every(numericOk) &&
    lineItems.every(
      (item) =>
        item.description.trim().length > 0 &&
        !Number.isNaN(Number(item.quantity)) &&
        !Number.isNaN(Number(item.unitPrice)) &&
        !Number.isNaN(Number(item.total))
    );

  async function save() {
    if (!formValid || isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor: vendor.trim(),
          invoiceNumber: invoiceNumber.trim() || null,
          invoiceDate: invoiceDate || null,
          dueDate: dueDate || null,
          currency: currency.trim().toUpperCase(),
          subtotal: subtotal === "" ? null : Number(subtotal),
          vatRate: vatRate === "" ? null : Number(vatRate),
          vatAmount: vatAmount === "" ? null : Number(vatAmount),
          total: Number(total),
          notes: notes.trim() || null,
          lineItems: lineItems.map((item) => ({
            description: item.description.trim(),
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            total: Number(item.total),
          })),
          // Saving a draft confirms the review.
          ...(invoice.status === "DRAFT" ? { status: "UNPAID" } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not save invoice", { description: body?.error ?? "Check the fields." });
        return;
      }
      toast.success(invoice.status === "DRAFT" ? "Invoice confirmed" : "Invoice saved");
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="inv-vendor">Vendor</Label>
          <Input
            id="inv-vendor"
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
            placeholder="Acme B.V."
            maxLength={200}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="inv-number">Invoice number</Label>
          <Input
            id="inv-number"
            value={invoiceNumber}
            onChange={(event) => setInvoiceNumber(event.target.value)}
            placeholder="INV-2026-001"
            maxLength={100}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="inv-date">Invoice date</Label>
          <Input
            id="inv-date"
            type="date"
            value={invoiceDate}
            onChange={(event) => setInvoiceDate(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="inv-due">Due date</Label>
          <Input
            id="inv-due"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="inv-currency">Currency</Label>
          <Input
            id="inv-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            maxLength={3}
            placeholder="EUR"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="inv-subtotal">Subtotal</Label>
          <Input
            id="inv-subtotal"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={subtotal}
            onChange={(event) => setSubtotal(event.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="inv-vat">VAT ({vatRate ? `${vatRate}%` : "%"})</Label>
          <div className="flex gap-1.5">
            <Input
              id="inv-vat-rate"
              type="number"
              step="0.1"
              min="0"
              max="100"
              inputMode="decimal"
              value={vatRate}
              onChange={(event) => setVatRate(event.target.value)}
              placeholder="%"
              className="w-16"
              aria-label="VAT rate"
            />
            <Input
              id="inv-vat"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={vatAmount}
              onChange={(event) => setVatAmount(event.target.value)}
              placeholder="0.00"
              aria-label="VAT amount"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="inv-total">Total</Label>
          <Input
            id="inv-total"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            placeholder="0.00"
            className="font-semibold"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Line items</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setLineItems((items) => [
                ...items,
                { description: "", quantity: "1", unitPrice: "0", total: "0" },
              ])
            }
          >
            <PlusIcon />
            Add line
          </Button>
        </div>
        {lineItems.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">
            No line items. Add lines or just keep the totals above.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="text-muted-foreground hidden grid-cols-[1fr_5rem_6rem_6rem_2rem] gap-2 px-1 text-xs sm:grid">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit price</span>
              <span>Total</span>
              <span />
            </div>
            {lineItems.map((item, index) => (
              <div
                key={index}
                className="grid grid-cols-2 gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_5rem_6rem_6rem_2rem] sm:border-0 sm:p-0"
              >
                <Input
                  value={item.description}
                  onChange={(event) => updateItem(index, { description: event.target.value })}
                  placeholder="Description"
                  className="col-span-2 sm:col-span-1"
                  aria-label={`Line ${index + 1} description`}
                />
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  inputMode="decimal"
                  value={item.quantity}
                  onChange={(event) => updateItem(index, { quantity: event.target.value })}
                  aria-label={`Line ${index + 1} quantity`}
                />
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={item.unitPrice}
                  onChange={(event) => updateItem(index, { unitPrice: event.target.value })}
                  aria-label={`Line ${index + 1} unit price`}
                />
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={item.total}
                  onChange={(event) => updateItem(index, { total: event.target.value })}
                  aria-label={`Line ${index + 1} total`}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive size-9 justify-self-end"
                  onClick={() => setLineItems((items) => items.filter((_, i) => i !== index))}
                  aria-label={`Remove line ${index + 1}`}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="inv-notes">Notes</Label>
        <Textarea
          id="inv-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional notes…"
          rows={2}
          maxLength={2000}
        />
      </div>

      <Button onClick={save} disabled={!formValid || isSaving} className="self-end">
        {isSaving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
        {invoice.status === "DRAFT" ? "Confirm & save" : "Save changes"}
      </Button>
    </div>
  );
}
