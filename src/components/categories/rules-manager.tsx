"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PlusIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CategoryOption } from "@/components/transactions/types";

export interface RuleItem {
  id: string;
  pattern: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
}

interface RulesManagerProps {
  rules: RuleItem[];
  categories: CategoryOption[];
}

export function RulesManager({ rules, categories }: RulesManagerProps) {
  const router = useRouter();
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const incomeCategories = categories.filter((category) => category.type === "INCOME");
  const expenseCategories = categories.filter((category) => category.type === "EXPENSE");

  async function createRule(event: React.FormEvent) {
    event.preventDefault();
    if (pattern.trim().length < 2 || !categoryId) return;
    setCreating(true);
    try {
      const response = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: pattern.trim(), categoryId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not create rule", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success("Rule created", {
        description: "It will be applied to imports and new transactions.",
      });
      setPattern("");
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setCreating(false);
    }
  }

  async function deleteRule(rule: RuleItem) {
    setBusyId(rule.id);
    try {
      const response = await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not delete rule", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success("Rule deleted");
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={createRule} className="bg-card flex flex-wrap items-end gap-3 rounded-xl border border-border/60 p-3 shadow-xs">
        <div className="grid min-w-44 flex-1 gap-1.5">
          <label htmlFor="rule-pattern" className="text-muted-foreground text-xs">
            When the description contains…
          </label>
          <Input
            id="rule-pattern"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            placeholder="e.g. spotify"
            maxLength={100}
          />
        </div>
        <div className="grid min-w-44 gap-1.5">
          <label className="text-muted-foreground text-xs">…assign this category</label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick a category" />
            </SelectTrigger>
            <SelectContent>
              {expenseCategories.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Expenses</SelectLabel>
                  {expenseCategories.map((category) => (
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
                </SelectGroup>
              )}
              {incomeCategories.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Income</SelectLabel>
                  {incomeCategories.map((category) => (
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
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={creating || pattern.trim().length < 2 || !categoryId}>
          {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          Add rule
        </Button>
      </form>

      {rules.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={WandSparklesIcon}
          title="No rules yet"
          description="A rule categorises every matching import and new transaction. Changing a category on a transaction writes one for that merchant automatically, so this list fills itself in as you work."
        />
      ) : (
        <div className="flex flex-col gap-1">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors"
            >
              <code className="bg-muted min-w-0 truncate rounded px-1.5 py-0.5 text-xs">
                {rule.pattern}
              </code>
              <span className="text-muted-foreground text-xs">→</span>
              <Badge variant="secondary" className="gap-1.5">
                {/* A DB-supplied hex is only safe as a swatch, not as a text
                    colour — amber categories landed near 2:1 as a label. */}
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: rule.categoryColor }}
                />
                {rule.categoryName}
              </Badge>
              <div className="flex-1" />
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive size-8"
                disabled={busyId === rule.id}
                onClick={() => deleteRule(rule)}
                aria-label={`Delete rule ${rule.pattern}`}
              >
                {busyId === rule.id ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
