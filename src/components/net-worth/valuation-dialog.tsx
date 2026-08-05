"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate } from "@/lib/utils";

import type { HoldingRow } from "./types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ValuationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding: HoldingRow;
  currency: string;
}

/**
 * Records a new figure for a holding. Appends rather than replaces: the
 * valuation history is what draws the net-worth line, so a correction is a
 * newer row and the old one stays where it was.
 */
export function ValuationDialog({
  open,
  onOpenChange,
  holding,
  currency,
}: ValuationDialogProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [asOf, setAsOf] = useState(today);
  const [isSaving, setIsSaving] = useState(false);

  const formValid = value !== "" && Number(value) >= 0 && asOf !== "";

  async function save() {
    if (!formValid || isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/net-worth/${holding.id}/valuations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: Number(value), asOf }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not record the value", {
          description: body?.error ?? "Try again.",
        });
        return;
      }
      toast.success(`${holding.name} updated`);
      setValue("");
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update {holding.name}</DialogTitle>
          <DialogDescription>
            {holding.asOf
              ? `Last recorded at ${formatCurrency(holding.value, currency)} on ${formatDate(holding.asOf)}. The old figure is kept, so the chart keeps its history.`
              : "The first figure for this one. Every later update is kept alongside it, which is what draws the chart."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="valuation-value">
              {holding.isLiability ? "Amount owed" : "Worth"}
            </Label>
            <Input
              id="valuation-value"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="valuation-as-of">As of</Label>
            <Input
              id="valuation-as-of"
              type="date"
              max={today()}
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={!formValid || isSaving}>
            {isSaving && <Loader2Icon className="animate-spin" />}
            Record value
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
