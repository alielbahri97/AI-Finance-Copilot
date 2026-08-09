"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PencilIcon, PlusIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

export interface AssumptionItem {
  id: string;
  kind: "ONE_OFF" | "RECURRING" | "PERCENT_GROWTH";
  type: "INCOME" | "EXPENSE";
  label: string;
  amount: number | null;
  percent: number | null;
  date: string | null;
  startDate: string | null;
  endDate: string | null;
  enabled: boolean;
}

interface AssumptionsManagerProps {
  assumptions: AssumptionItem[];
  currency: string;
  /**
   * The scenario these assumptions belong to, and that new ones are written
   * into. Omitted (or the base scenario's id) means the base scenario, which is
   * what every assumption held before scenarios existed.
   */
  scenarioId?: string;
  scenarioName?: string;
}

const KIND_LABELS: Record<AssumptionItem["kind"], string> = {
  ONE_OFF: "One-off",
  RECURRING: "Monthly",
  PERCENT_GROWTH: "% growth",
};

interface FormState {
  kind: AssumptionItem["kind"];
  type: "INCOME" | "EXPENSE";
  label: string;
  amount: string;
  percent: string;
  date: string;
  startDate: string;
  endDate: string;
}

const EMPTY_FORM: FormState = {
  kind: "ONE_OFF",
  type: "EXPENSE",
  label: "",
  amount: "",
  percent: "",
  date: "",
  startDate: "",
  endDate: "",
};

function describe(assumption: AssumptionItem, currency: string): string {
  const locale = localeForCurrency(currency);
  const side = assumption.type === "INCOME" ? "income" : "expense";
  if (assumption.kind === "ONE_OFF") {
    return `${formatCurrency(assumption.amount ?? 0, currency, locale)} ${side} on ${assumption.date ? formatDate(assumption.date, locale) : "?"}`;
  }
  if (assumption.kind === "RECURRING") {
    const window = [
      assumption.startDate ? `from ${formatDate(assumption.startDate, locale)}` : null,
      assumption.endDate ? `until ${formatDate(assumption.endDate, locale)}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return `${formatCurrency(assumption.amount ?? 0, currency, locale)}/month ${side}${window ? ` ${window}` : ""}`;
  }
  return `${assumption.percent ?? 0}% ${side} growth per month (compounding)`;
}

export function AssumptionsManager({
  assumptions,
  currency,
  scenarioId,
  scenarioName,
}: AssumptionsManagerProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(assumption: AssumptionItem) {
    setEditingId(assumption.id);
    setForm({
      kind: assumption.kind,
      type: assumption.type,
      label: assumption.label,
      amount: assumption.amount !== null ? String(assumption.amount) : "",
      percent: assumption.percent !== null ? String(assumption.percent) : "",
      date: assumption.date ?? "",
      startDate: assumption.startDate ?? "",
      endDate: assumption.endDate ?? "",
    });
    setDialogOpen(true);
  }

  const formValid =
    form.label.trim().length > 0 &&
    (form.kind === "PERCENT_GROWTH"
      ? form.percent !== "" && !Number.isNaN(Number(form.percent))
      : form.amount !== "" && Number(form.amount) > 0) &&
    (form.kind !== "ONE_OFF" || form.date !== "");

  async function save() {
    if (!formValid || isSaving) return;
    setIsSaving(true);

    const payload: Record<string, unknown> = {
      kind: form.kind,
      type: form.type,
      label: form.label.trim(),
      // Only meaningful on create; the update route leaves the scenario alone.
      ...(scenarioId ? { scenarioId } : {}),
    };
    if (form.kind === "PERCENT_GROWTH") {
      payload.percent = Number(form.percent);
    } else {
      payload.amount = Number(form.amount);
    }
    if (form.kind === "ONE_OFF") {
      payload.date = form.date;
    } else {
      payload.startDate = form.startDate || null;
      payload.endDate = form.endDate || null;
    }

    try {
      const response = await fetch(
        editingId ? `/api/assumptions/${editingId}` : "/api/assumptions",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not save assumption", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success(editingId ? "Assumption updated" : "Assumption added", {
        description: "The forecast has been recalculated.",
      });
      setDialogOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  async function toggle(assumption: AssumptionItem, enabled: boolean) {
    setBusyId(assumption.id);
    try {
      const response = await fetch(`/api/assumptions/${assumption.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not update assumption", { description: body?.error });
        return;
      }
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(assumption: AssumptionItem) {
    setBusyId(assumption.id);
    try {
      const response = await fetch(`/api/assumptions/${assumption.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not delete assumption", { description: body?.error });
        return;
      }
      toast.success("Assumption deleted", { description: "The forecast has been recalculated." });
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {scenarioName
            ? `What-if adjustments in "${scenarioName}", applied on top of the data-driven forecast.`
            : "What-if adjustments applied on top of the data-driven forecast."}
        </p>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon />
          Add assumption
        </Button>
      </div>

      {assumptions.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={SlidersHorizontalIcon}
          title={scenarioName ? `Nothing in "${scenarioName}" yet` : "No assumptions yet"}
          description="Add a one-off or repeating amount the data cannot know about — an expected invoice payment, or a new hire from March — and the forecast folds it in."
          action={
            <Button size="sm" variant="outline" onClick={openCreate}>
              <PlusIcon />
              Add assumption
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-1">
          {assumptions.map((assumption) => (
            <div
              key={assumption.id}
              className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
            >
              <Switch
                checked={assumption.enabled}
                disabled={busyId === assumption.id}
                onCheckedChange={(checked) => toggle(assumption, checked)}
                aria-label={`Toggle ${assumption.label}`}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    assumption.enabled
                      ? "truncate text-sm font-medium"
                      : "text-muted-foreground truncate text-sm font-medium line-through"
                  }
                >
                  {assumption.label}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {describe(assumption, currency)}
                </p>
              </div>
              <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                {KIND_LABELS[assumption.kind]}
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground size-8 shrink-0"
                onClick={() => openEdit(assumption)}
                aria-label={`Edit ${assumption.label}`}
              >
                <PencilIcon />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                disabled={busyId === assumption.id}
                onClick={() => remove(assumption)}
                aria-label={`Delete ${assumption.label}`}
              >
                {busyId === assumption.id ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit assumption" : "Add assumption"}</DialogTitle>
            <DialogDescription>
              Adjust the forecast with expected future income, expenses or growth.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Kind</Label>
                <Select
                  value={form.kind}
                  onValueChange={(value) =>
                    setForm({ ...form, kind: value as AssumptionItem["kind"] })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ONE_OFF">One-off on a date</SelectItem>
                    <SelectItem value="RECURRING">Monthly recurring</SelectItem>
                    <SelectItem value="PERCENT_GROWTH">% growth per month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Side</Label>
                <Tabs
                  value={form.type}
                  onValueChange={(value) => setForm({ ...form, type: value as "INCOME" | "EXPENSE" })}
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="EXPENSE">Expense</TabsTrigger>
                    <TabsTrigger value="INCOME">Income</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="assumption-label">Label</Label>
              <Input
                id="assumption-label"
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                placeholder={
                  form.kind === "ONE_OFF"
                    ? "e.g. Expected invoice payment"
                    : form.kind === "RECURRING"
                      ? "e.g. New hire salary"
                      : "e.g. Revenue growth"
                }
                maxLength={100}
              />
            </div>

            {form.kind === "PERCENT_GROWTH" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="assumption-percent">Growth per month (%)</Label>
                <Input
                  id="assumption-percent"
                  type="number"
                  step="0.1"
                  min="-50"
                  max="100"
                  inputMode="decimal"
                  value={form.percent}
                  onChange={(event) => setForm({ ...form, percent: event.target.value })}
                  placeholder="e.g. 2 for +2% each month"
                />
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="assumption-amount">
                  Amount{form.kind === "RECURRING" ? " per month" : ""}
                </Label>
                <Input
                  id="assumption-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: event.target.value })}
                  placeholder="0.00"
                />
              </div>
            )}

            {form.kind === "ONE_OFF" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="assumption-date">Date</Label>
                <Input
                  id="assumption-date"
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="assumption-start">Start (optional)</Label>
                  <Input
                    id="assumption-start"
                    type="date"
                    value={form.startDate}
                    onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="assumption-end">End (optional)</Label>
                  <Input
                    id="assumption-end"
                    type="date"
                    value={form.endDate}
                    onChange={(event) => setForm({ ...form, endDate: event.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={save} disabled={!formValid || isSaving}>
              {isSaving && <Loader2Icon className="animate-spin" />}
              {editingId ? "Save changes" : "Add assumption"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
