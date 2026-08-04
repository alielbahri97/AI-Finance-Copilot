"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { GoalCard } from "./goal-card";
import { GoalDialog } from "./goal-dialog";
import type { GoalCardData, GoalOption } from "./types";

interface GoalsManagerProps {
  goals: GoalCardData[];
  archived: GoalCardData[];
  categories: GoalOption[];
  accounts: GoalOption[];
  currency: string;
  canEdit: boolean;
}

export function GoalsManager({
  goals,
  archived,
  categories,
  accounts,
  currency,
  canEdit,
}: GoalsManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GoalCardData | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(goal: GoalCardData) {
    setEditing(goal);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Your goals</h2>
        {canEdit ? (
          <Button size="sm" onClick={openCreate}>
            <PlusIcon />
            New goal
          </Button>
        ) : null}
      </div>

      {goals.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="font-medium">No savings goals yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Name what you are saving for and how much it takes. Record what you put aside and
            this page will tell you when you get there at the rate you are actually saving.
          </p>
          {canEdit ? (
            <Button className="mt-4" onClick={openCreate}>
              <PlusIcon />
              Create your first goal
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              currency={currency}
              canEdit={canEdit}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      {archived.length > 0 ? (
        <details className="group">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm select-none">
            <span className="group-open:hidden">Show {archived.length} archived</span>
            <span className="hidden group-open:inline">Hide archived</span>
          </summary>
          <div className="mt-3 grid gap-4 xl:grid-cols-2">
            {archived.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                currency={currency}
                canEdit={canEdit}
                onEdit={openEdit}
              />
            ))}
          </div>
        </details>
      ) : null}

      <GoalDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        goal={editing}
        categories={categories}
        accounts={accounts}
      />
    </div>
  );
}
