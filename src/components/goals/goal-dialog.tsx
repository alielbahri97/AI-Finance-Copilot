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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import type { GoalCardData, GoalOption } from "./types";

/** Radix selects need a non-empty value, so "no link" gets its own token. */
const NONE = "none";

interface FormState {
  name: string;
  targetAmount: string;
  targetDate: string;
  startingAmount: string;
  categoryId: string;
  bankAccountId: string;
  note: string;
}

function initialForm(
  goal: GoalCardData | null,
  suggest?: { name?: string; targetAmount?: string; targetDate?: string } | null
): FormState {
  if (!goal) {
    return {
      name: suggest?.name ?? "",
      targetAmount: suggest?.targetAmount ?? "",
      targetDate: suggest?.targetDate ?? "",
      startingAmount: "",
      categoryId: NONE,
      bankAccountId: NONE,
      note: "",
    };
  }
  return {
    name: goal.name,
    targetAmount: String(goal.targetAmount),
    targetDate: goal.targetDate ?? "",
    startingAmount: goal.startingAmount ? String(goal.startingAmount) : "",
    categoryId: goal.categoryId ?? NONE,
    bankAccountId: goal.bankAccountId ?? NONE,
    note: goal.note ?? "",
  };
}

interface GoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null creates a goal. Remount with a key when the edited goal changes. */
  goal: GoalCardData | null;
  categories: GoalOption[];
  accounts: GoalOption[];
  /** Prefill when opening from the personal questionnaire suggestions. */
  suggest?: { name?: string; targetAmount?: string; targetDate?: string } | null;
}

export function GoalDialog({
  open,
  onOpenChange,
  goal,
  categories,
  accounts,
  suggest = null,
}: GoalDialogProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialForm(goal, suggest));
  const [isSaving, setIsSaving] = useState(false);

  const formValid = form.name.trim().length > 0 && Number(form.targetAmount) > 0;

  async function save() {
    if (!formValid || isSaving) return;
    setIsSaving(true);

    const payload = {
      name: form.name.trim(),
      targetAmount: Number(form.targetAmount),
      targetDate: form.targetDate || null,
      startingAmount: form.startingAmount ? Number(form.startingAmount) : 0,
      categoryId: form.categoryId === NONE ? null : form.categoryId,
      bankAccountId: form.bankAccountId === NONE ? null : form.bankAccountId,
      note: form.note.trim() || null,
    };

    try {
      const response = await fetch(goal ? `/api/goals/${goal.id}` : "/api/goals", {
        method: goal ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not save goal", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success(goal ? "Goal updated" : "Goal created");
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
          <DialogTitle>{goal ? "Edit goal" : "New savings goal"}</DialogTitle>
          <DialogDescription>
            A target amount is enough to start. Add a date to see what it asks of you each
            month.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="goal-name">Name</Label>
            <Input
              id="goal-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="e.g. Emergency fund"
              maxLength={80}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="goal-target">Target amount</Label>
              <Input
                id="goal-target"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={form.targetAmount}
                onChange={(event) => setForm({ ...form, targetAmount: event.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="goal-date">Target date (optional)</Label>
              <Input
                id="goal-date"
                type="date"
                value={form.targetDate}
                onChange={(event) => setForm({ ...form, targetDate: event.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="goal-starting">Already set aside (optional)</Label>
            <Input
              id="goal-starting"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={form.startingAmount}
              onChange={(event) => setForm({ ...form, startingAmount: event.target.value })}
              placeholder="0.00"
            />
            <p className="text-muted-foreground text-xs">
              Counts towards progress, but not towards your monthly saving rate.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label>Category (optional)</Label>
            <Select
              value={form.categoryId}
              onValueChange={(value) => setForm({ ...form, categoryId: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No category</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Transactions in this category are offered as contributions to record.
            </p>
          </div>

          {accounts.length > 0 ? (
            <div className="grid gap-1.5">
              <Label>Account (optional)</Label>
              <Select
                value={form.bankAccountId}
                onValueChange={(value) => setForm({ ...form, bankAccountId: value })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No account</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="goal-note">Note (optional)</Label>
            <Textarea
              id="goal-note"
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              placeholder="What this is for"
              maxLength={500}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={!formValid || isSaving}>
            {isSaving && <Loader2Icon className="animate-spin" />}
            {goal ? "Save changes" : "Create goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
