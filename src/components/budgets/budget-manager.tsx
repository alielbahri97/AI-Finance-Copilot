"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { BudgetProgress, BudgetSummary } from "@/lib/personal/budgets";
import type { BudgetCategoryOption } from "@/lib/personal/budgets-data";
import { formatCurrency, localeForCurrency } from "@/lib/utils";

import { STATUS_TONES } from "./status-tone";

const formSchema = z.object({
  categoryId: z.string().min(1, "Pick a category"),
  limit: z
    .string()
    .min(1, "Enter a monthly limit")
    .refine((value) => !Number.isNaN(Number(value)), "Enter a valid number")
    .refine((value) => Number(value) > 0, "The limit must be greater than zero"),
  rollover: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

const EMPTY_VALUES: FormValues = { categoryId: "", limit: "", rollover: false };

interface BudgetManagerProps {
  summary: BudgetSummary;
  categories: BudgetCategoryOption[];
  currency: string;
  canEdit: boolean;
}

/** The over/under line under each bar: "40.00 left" or "12.50 over budget". */
function verdict(budget: BudgetProgress, currency: string, locale: string): string {
  return budget.remaining < 0
    ? `${formatCurrency(Math.abs(budget.remaining), currency, locale)} over budget`
    : `${formatCurrency(budget.remaining, currency, locale)} left`;
}

export function BudgetManager({ summary, categories, currency, canEdit }: BudgetManagerProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLimit, setEditLimit] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const locale = localeForCurrency(currency);
  const money = (value: number) => formatCurrency(value, currency, locale);

  /** The empty state's way out: the create form is already on the page. */
  function startFirstBudget() {
    const form = formRef.current;
    form?.scrollIntoView({ behavior: "smooth", block: "center" });
    form?.querySelector<HTMLElement>("[data-slot='select-trigger']")?.focus();
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: EMPTY_VALUES,
  });

  const budgeted = new Set(summary.budgets.map((budget) => budget.category));
  const available = categories.filter(
    (category) => category.type === "EXPENSE" && !budgeted.has(category.name)
  );

  async function createBudget(values: FormValues) {
    const response = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: values.categoryId,
        limit: Number(values.limit),
        rollover: values.rollover,
        month: summary.month,
        year: summary.year,
      }),
    }).catch(() => null);

    if (!response) {
      toast.error("Network error", { description: "Please try again." });
      return;
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error("Could not save budget", { description: body?.error ?? "Try again." });
      return;
    }

    toast.success("Budget saved");
    form.reset(EMPTY_VALUES);
    router.refresh();
  }

  async function updateBudget(budget: BudgetProgress, data: { limit?: number; rollover?: boolean }) {
    setBusyId(budget.id);
    try {
      const response = await fetch(`/api/budgets/${budget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not update budget", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success(`${budget.category} budget updated`);
      setEditingId(null);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteBudget(budget: BudgetProgress) {
    setBusyId(budget.id);
    try {
      const response = await fetch(`/api/budgets/${budget.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not delete budget", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success(`${budget.category} budget removed`);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  const colors = new Map(categories.map((category) => [category.name, category.color]));

  return (
    <div className="flex flex-col gap-6">
      {canEdit && (
        <Form {...form}>
          <form
            ref={formRef}
            onSubmit={form.handleSubmit(createBudget)}
            className="bg-card flex flex-wrap items-start gap-3 rounded-lg border p-3"
          >
            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem className="min-w-48 flex-1">
                  <FormLabel className="text-muted-foreground text-xs font-normal">
                    Category
                  </FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={available.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            available.length === 0 ? "Every category is budgeted" : "Pick a category"
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {available.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="size-2.5 rounded-full"
                              style={{ backgroundColor: category.color }}
                            />
                            {category.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="limit"
              render={({ field }) => (
                <FormItem className="w-36">
                  <FormLabel className="text-muted-foreground text-xs font-normal">
                    Monthly limit
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      placeholder="0.00"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rollover"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 pt-6">
                  <FormControl>
                    <Switch
                      id="new-budget-rollover"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel
                    htmlFor="new-budget-rollover"
                    className="text-muted-foreground text-xs font-normal"
                  >
                    Roll over
                  </FormLabel>
                </FormItem>
              )}
            />
            <Button type="submit" className="mt-6" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              Add budget
            </Button>
          </form>
        </Form>
      )}

      {summary.budgets.length === 0 ? (
        <EmptyState
          icon={WalletIcon}
          title="No budgets for this month"
          description={
            canEdit
              ? "Set a monthly limit on a category and this page will show how the month is tracking against it."
              : "Once someone with edit access sets a monthly limit on a category, this page will show how the month is tracking against it."
          }
          action={
            canEdit ? (
              <Button onClick={startFirstBudget}>
                <PlusIcon />
                Set your first limit
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="flex flex-col gap-1">
          {summary.budgets.map((budget) => {
            const isEditing = editingId === budget.id;
            const isBusy = busyId === budget.id;
            return (
              <div
                key={budget.id}
                className="hover:bg-muted/50 flex flex-col gap-2 rounded-lg px-2 py-3 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: colors.get(budget.category) ?? "#94a3b8" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {budget.category}
                  </span>

                  {isEditing ? (
                    <>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        value={editLimit}
                        onChange={(event) => setEditLimit(event.target.value)}
                        className="h-8 w-28"
                        aria-label={`Monthly limit for ${budget.category}`}
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        disabled={isBusy || !(Number(editLimit) > 0)}
                        onClick={() => updateBudget(budget, { limit: Number(editLimit) })}
                        aria-label="Save limit"
                      >
                        {isBusy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        onClick={() => setEditingId(null)}
                        aria-label="Cancel editing"
                      >
                        <XIcon />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm tabular-nums">
                        {money(budget.spent)}
                        <span className="text-muted-foreground">
                          {" of "}
                          {money(budget.available)}
                        </span>
                      </span>
                      {canEdit && (
                        <>
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`rollover-${budget.id}`}
                              checked={budget.rollover}
                              disabled={isBusy}
                              onCheckedChange={(checked) =>
                                updateBudget(budget, { rollover: checked })
                              }
                            />
                            <Label
                              htmlFor={`rollover-${budget.id}`}
                              className="text-muted-foreground text-xs font-normal"
                            >
                              Roll over
                            </Label>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-muted-foreground size-8"
                            onClick={() => {
                              setEditingId(budget.id);
                              setEditLimit(budget.limit.toFixed(2));
                            }}
                            aria-label={`Edit ${budget.category} limit`}
                          >
                            <PencilIcon />
                          </Button>
                          <ConfirmDialog
                            trigger={
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-muted-foreground hover:text-destructive size-8"
                                disabled={isBusy}
                                aria-label={`Delete ${budget.category} budget`}
                              >
                                {isBusy ? (
                                  <Loader2Icon className="animate-spin" />
                                ) : (
                                  <Trash2Icon />
                                )}
                              </Button>
                            }
                            title={`Delete the ${budget.category} budget?`}
                            description={`Your ${budget.category} spending stays on record. You just stop tracking it against a ${money(budget.limit)} monthly limit, and this page will no longer warn you when it runs over.`}
                            confirmLabel="Delete budget"
                            onConfirm={() => deleteBudget(budget)}
                          />
                        </>
                      )}
                    </>
                  )}
                </div>

                <Progress
                  value={budget.ratio * 100}
                  tone={STATUS_TONES[budget.status]}
                  label={`${budget.category} budget used`}
                />

                <div className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                  <span className={budget.status === "over" ? "text-destructive" : undefined}>
                    {verdict(budget, currency, locale)}
                  </span>
                  <span>· Limit {money(budget.limit)}</span>
                  {budget.rollover && budget.carriedOver !== 0 && (
                    <span>
                      ·{" "}
                      {budget.carriedOver > 0
                        ? `${money(budget.carriedOver)} carried over`
                        : `${money(Math.abs(budget.carriedOver))} carried over as an overspend`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
