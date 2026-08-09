"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface CategoryItem {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  color: string;
  isDefault: boolean;
  transactionCount: number;
}

interface CategoryManagerProps {
  categories: CategoryItem[];
}

const RANDOM_COLORS = [
  "#005ADB", "#f59e0b", "#3b82f6", "#ef4444", "#ec4899",
  "#22c55e", "#0ea5e9", "#f97316", "#14b8a6", "#64748b",
];

export function CategoryManager({ categories }: CategoryManagerProps) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [newColor, setNewColor] = useState(RANDOM_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), type: newType, color: newColor }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not create category", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success(`Category "${newName.trim()}" created`);
      setNewName("");
      setNewColor(RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)]);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setCreating(false);
    }
  }

  function startEdit(category: CategoryItem) {
    setEditingId(category.id);
    setEditName(category.name);
    setEditColor(category.color);
  }

  async function saveEdit(category: CategoryItem) {
    setBusyId(category.id);
    try {
      const response = await fetch(`/api/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not update category", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success("Category updated");
      setEditingId(null);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteCategory(category: CategoryItem) {
    setBusyId(category.id);
    try {
      const response = await fetch(`/api/categories/${category.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not delete category", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success(`Category "${category.name}" deleted`, {
        description:
          category.transactionCount > 0
            ? `${category.transactionCount} transactions are now uncategorized.`
            : undefined,
      });
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  const groups: { label: string; type: "EXPENSE" | "INCOME" }[] = [
    { label: "Expense categories", type: "EXPENSE" },
    { label: "Income categories", type: "INCOME" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={createCategory}
        className="bg-card flex flex-wrap items-end gap-3 rounded-lg border p-3"
      >
        <div className="grid min-w-44 flex-1 gap-1.5">
          <label htmlFor="new-category-name" className="text-muted-foreground text-xs">
            New category
          </label>
          <Input
            id="new-category-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="e.g. Pets"
            maxLength={50}
          />
        </div>
        <Tabs value={newType} onValueChange={(value) => setNewType(value as "INCOME" | "EXPENSE")}>
          <TabsList>
            <TabsTrigger value="EXPENSE">Expense</TabsTrigger>
            <TabsTrigger value="INCOME">Income</TabsTrigger>
          </TabsList>
        </Tabs>
        <input
          type="color"
          value={newColor}
          onChange={(event) => setNewColor(event.target.value)}
          className="border-input size-9 cursor-pointer rounded-md border bg-transparent p-1"
          aria-label="Category color"
        />
        <Button type="submit" disabled={creating || !newName.trim()}>
          {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          Add
        </Button>
      </form>

      {groups.map((group) => {
        const items = categories.filter((category) => category.type === group.type);
        return (
          <div key={group.type} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{group.label}</h3>
            {items.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No {group.label.toLowerCase()} yet — add one above.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {items.map((category) => (
                  <div
                    key={category.id}
                    className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors"
                  >
                    {editingId === category.id ? (
                      <>
                        <input
                          type="color"
                          value={editColor}
                          onChange={(event) => setEditColor(event.target.value)}
                          className="border-input size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
                          aria-label={`Color for ${category.name}`}
                        />
                        <Input
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          className="h-8 max-w-56"
                          maxLength={50}
                          autoFocus
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          disabled={busyId === category.id || !editName.trim()}
                          onClick={() => saveEdit(category)}
                          aria-label="Save changes"
                        >
                          {busyId === category.id ? (
                            <Loader2Icon className="animate-spin" />
                          ) : (
                            <CheckIcon />
                          )}
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
                        <span
                          className="size-3 shrink-0 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {category.name}
                        </span>
                        <Badge variant="secondary" className="hidden sm:inline-flex">
                          {category.transactionCount} tx
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-muted-foreground size-8"
                          onClick={() => startEdit(category)}
                          aria-label={`Edit ${category.name}`}
                        >
                          <PencilIcon />
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive size-8"
                              disabled={busyId === category.id}
                              aria-label={`Delete ${category.name}`}
                            >
                              {busyId === category.id ? (
                                <Loader2Icon className="animate-spin" />
                              ) : (
                                <Trash2Icon />
                              )}
                            </Button>
                          }
                          title={`Delete the ${category.name} category?`}
                          description={
                            category.transactionCount > 0
                              ? `${category.transactionCount} transaction${category.transactionCount === 1 ? "" : "s"} will become uncategorized. They keep their amounts and dates, but they lose this label and stop counting towards ${category.name} in your reports.`
                              : `Nothing is filed under ${category.name} yet, so nothing else changes.`
                          }
                          confirmLabel="Delete category"
                          onConfirm={() => deleteCategory(category)}
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
