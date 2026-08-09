"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "@/lib/toast";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ASSET_KIND_LABELS,
  ASSET_KINDS,
  isLiabilityKind,
  type AssetKind,
} from "@/lib/personal/net-worth";

import type { HoldingRow } from "./types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface FormState {
  name: string;
  kind: AssetKind;
  value: string;
  asOf: string;
  note: string;
}

function initialForm(holding: HoldingRow | null, defaultKind: AssetKind): FormState {
  if (!holding) {
    return { name: "", kind: defaultKind, value: "", asOf: today(), note: "" };
  }
  return {
    name: holding.name,
    kind: holding.kind,
    value: "",
    asOf: today(),
    note: holding.note ?? "",
  };
}

interface AssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null creates a holding. Remount with a key when the edited one changes. */
  holding: HoldingRow | null;
  /** Which side the "Add" button was on, so the form starts on the right one. */
  defaultKind: AssetKind;
  currency: string;
}

/**
 * One form for both sides of the balance sheet — the kind decides which — and
 * for both creating and editing.
 *
 * Editing deliberately does not offer the value: worth is appended through the
 * valuations route so the history stays intact, and "Update value" is a
 * separate, smaller action. On creation the opening figure is offered inline,
 * because a holding with no value at all is not much use.
 */
export function AssetDialog({
  open,
  onOpenChange,
  holding,
  defaultKind,
  currency,
}: AssetDialogProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialForm(holding, defaultKind));
  const [isSaving, setIsSaving] = useState(false);

  const owed = isLiabilityKind(form.kind);
  const formValid = form.name.trim().length > 0 && (holding !== null || form.asOf !== "");

  async function save() {
    if (!formValid || isSaving) return;
    setIsSaving(true);

    const payload = holding
      ? { name: form.name.trim(), kind: form.kind, note: form.note.trim() || null }
      : {
          name: form.name.trim(),
          kind: form.kind,
          note: form.note.trim() || null,
          ...(form.value === "" ? {} : { value: Number(form.value), asOf: form.asOf }),
        };

    try {
      const response = await fetch(
        holding ? `/api/net-worth/${holding.id}` : "/api/net-worth",
        {
          method: holding ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not save", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success(holding ? "Saved" : owed ? "Debt added" : "Asset added");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {holding ? `Edit ${holding.name}` : owed ? "Add a debt" : "Add an asset"}
          </DialogTitle>
          <DialogDescription>
            {holding
              ? "Worth is recorded separately, so the history stays intact — use “Update value” for a new figure."
              : "Only what your connected accounts do not already report. Bank balances are counted automatically."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="asset-name">Name</Label>
            <Input
              id="asset-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={owed ? "e.g. Mortgage" : "e.g. Our house"}
              maxLength={80}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>What is it</Label>
            <Select
              value={form.kind}
              onValueChange={(value) => setForm({ ...form, kind: value as AssetKind })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSET_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {ASSET_KIND_LABELS[kind]}
                    {isLiabilityKind(kind) ? " (owed)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {holding ? null : (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="asset-value">
                  {owed ? "Amount owed" : "What it is worth"}
                </Label>
                <Input
                  id="asset-value"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={form.value}
                  onChange={(event) => setForm({ ...form, value: event.target.value })}
                  placeholder="0.00"
                />
                <p className="text-muted-foreground text-xs">
                  In {currency}
                  {owed ? ", as a positive amount" : ""}. Leave blank to add it later.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="asset-as-of">As of</Label>
                <Input
                  id="asset-as-of"
                  type="date"
                  max={today()}
                  value={form.asOf}
                  onChange={(event) => setForm({ ...form, asOf: event.target.value })}
                />
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="asset-note">Note (optional)</Label>
            <Textarea
              id="asset-note"
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              placeholder={owed ? "Lender, rate, term" : "Where it is, how it is valued"}
              maxLength={500}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={!formValid || isSaving}>
            {isSaving && <Loader2Icon className="animate-spin" />}
            {holding ? "Save changes" : owed ? "Add debt" : "Add asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
