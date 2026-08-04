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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ContributionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goalId: string;
  goalName: string;
}

export function ContributionDialog({
  open,
  onOpenChange,
  goalId,
  goalName,
}: ContributionDialogProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const formValid = Number(amount) > 0 && date !== "";

  async function save() {
    if (!formValid || isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/goals/${goalId}/contributions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), date, note: note.trim() || null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not record contribution", {
          description: body?.error ?? "Try again.",
        });
        return;
      }
      toast.success("Contribution recorded", {
        description: body?.achievedAt ? `${goalName} is now fully funded.` : undefined,
      });
      setAmount("");
      setNote("");
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
          <DialogTitle>Record a contribution</DialogTitle>
          <DialogDescription>
            Money put aside for {goalName}. It counts towards progress and towards the monthly
            rate the projection uses.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="contribution-amount">Amount</Label>
              <Input
                id="contribution-amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contribution-date">Date</Label>
              <Input
                id="contribution-date"
                type="date"
                max={today()}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="contribution-note">Note (optional)</Label>
            <Input
              id="contribution-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Bonus"
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={!formValid || isSaving}>
            {isSaving && <Loader2Icon className="animate-spin" />}
            Record contribution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
