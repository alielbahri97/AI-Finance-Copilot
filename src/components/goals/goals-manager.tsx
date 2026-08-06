"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PiggyBankIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const suggest = useMemo(() => {
    const name = searchParams.get("suggest")?.trim();
    if (!name) return null;
    return {
      name,
      targetAmount: searchParams.get("amount")?.trim() || undefined,
      targetDate: searchParams.get("date")?.trim() || undefined,
    };
  }, [searchParams]);

  const [dialogOpen, setDialogOpen] = useState(Boolean(suggest) && canEdit);
  const [editing, setEditing] = useState<GoalCardData | null>(null);

  useEffect(() => {
    if (suggest && canEdit) {
      setEditing(null);
      setDialogOpen(true);
    }
  }, [suggest, canEdit]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(goal: GoalCardData) {
    setEditing(goal);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open && suggest) {
      // Clear suggestion query params so refreshing does not reopen the dialog.
      router.replace("/goals");
    }
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
        <EmptyState
          className="rounded-xl border border-dashed"
          icon={PiggyBankIcon}
          title="No savings goals yet"
          description={
            canEdit
              ? "Name what you are saving for and how much it takes. Record what you put aside and this page will tell you when you get there at the rate you are actually saving."
              : "Nobody has set one up yet. An owner or admin can add the first goal, and it will appear here for everyone."
          }
          action={
            canEdit ? (
              <Button onClick={openCreate}>
                <PlusIcon />
                Create your first goal
              </Button>
            ) : undefined
          }
        />
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
        key={editing?.id ?? `new-${suggest?.name ?? "blank"}`}
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        goal={editing}
        categories={categories}
        accounts={accounts}
        suggest={editing ? null : suggest}
      />
    </div>
  );
}
