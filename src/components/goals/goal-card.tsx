"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, formatDate } from "@/lib/utils";

import { ContributionDialog } from "./contribution-dialog";
import { projectionSentences, STATUS_BADGES, STATUS_LABELS, STATUS_TONES } from "./status";
import type { GoalCardData, GoalSuggestionItem } from "./types";

interface GoalCardProps {
  goal: GoalCardData;
  currency: string;
  canEdit: boolean;
  onEdit: (goal: GoalCardData) => void;
}

export function GoalCard({ goal, currency, canEdit, onEdit }: GoalCardProps) {
  const router = useRouter();
  const [contributionOpen, setContributionOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function send(key: string, url: string, init: RequestInit, success: string) {
    setBusy(key);
    try {
      const response = await fetch(url, init);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not update goal", { description: body?.error ?? "Try again." });
        return;
      }
      toast.success(success);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusy(null);
    }
  }

  function toggleArchive() {
    return send(
      "archive",
      `/api/goals/${goal.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !goal.archived }),
      },
      goal.archived ? "Goal restored" : "Goal archived"
    );
  }

  function remove() {
    return send("delete", `/api/goals/${goal.id}`, { method: "DELETE" }, "Goal deleted");
  }

  function recordSuggestion(suggestion: GoalSuggestionItem) {
    return send(
      suggestion.transactionId,
      `/api/goals/${goal.id}/contributions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: suggestion.amount,
          date: suggestion.date,
          transactionId: suggestion.transactionId,
          note: suggestion.description,
        }),
      },
      "Contribution recorded"
    );
  }

  function removeContribution(contributionId: string) {
    return send(
      contributionId,
      `/api/goals/${goal.id}/contributions/${contributionId}`,
      { method: "DELETE" },
      "Contribution removed"
    );
  }

  const sentences = projectionSentences(goal, currency);
  const links = [
    goal.categoryName ? `Category: ${goal.categoryName}` : null,
    goal.bankAccountLabel ? `Account: ${goal.bankAccountLabel}` : null,
  ].filter((entry): entry is string => entry !== null);

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="truncate">{goal.name}</span>
          <Badge variant={STATUS_BADGES[goal.status]}>{STATUS_LABELS[goal.status]}</Badge>
          {goal.archived ? <Badge variant="secondary">Archived</Badge> : null}
        </CardTitle>
        {canEdit ? (
          <CardAction className="flex items-center gap-1">
            {!goal.archived ? (
              <Button size="sm" variant="outline" onClick={() => setContributionOpen(true)}>
                <PlusIcon />
                Contribution
              </Button>
            ) : null}
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground size-8"
              onClick={() => onEdit(goal)}
              aria-label={`Edit ${goal.name}`}
            >
              <PencilIcon />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground size-8"
              disabled={busy === "archive"}
              onClick={toggleArchive}
              aria-label={goal.archived ? `Restore ${goal.name}` : `Archive ${goal.name}`}
            >
              {busy === "archive" ? (
                <Loader2Icon className="animate-spin" />
              ) : goal.archived ? (
                <ArchiveRestoreIcon />
              ) : (
                <ArchiveIcon />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive size-8"
              disabled={busy === "delete"}
              onClick={remove}
              aria-label={`Delete ${goal.name}`}
            >
              {busy === "delete" ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium tabular-nums">
              {formatCurrency(goal.saved, currency)}{" "}
              <span className="text-muted-foreground font-normal">
                of {formatCurrency(goal.targetAmount, currency)}
              </span>
            </span>
            <span className="text-muted-foreground tabular-nums">
              {Math.round(goal.progress * 100)}%
            </span>
          </div>
          <Progress
            value={goal.progress * 100}
            tone={STATUS_TONES[goal.status]}
            label={`${goal.name} progress`}
          />
        </div>

        <div className="text-muted-foreground space-y-1 text-sm">
          {sentences.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground text-xs">Saving per month</dt>
            <dd className="tabular-nums">{formatCurrency(goal.monthlyRate, currency)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Needed per month</dt>
            <dd className="tabular-nums">
              {goal.requiredMonthlyRate === null
                ? "—"
                : formatCurrency(goal.requiredMonthlyRate, currency)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {goal.achievedAt ? "Achieved" : "Projected"}
            </dt>
            <dd>
              {goal.achievedAt
                ? formatDate(goal.achievedAt)
                : goal.projectedCompletion
                  ? formatDate(goal.projectedCompletion)
                  : "No projection"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Target date</dt>
            <dd>{goal.targetDate ? formatDate(goal.targetDate) : "No date"}</dd>
          </div>
        </dl>

        {links.length > 0 || goal.note ? (
          <p className="text-muted-foreground text-xs">
            {[...links, goal.note].filter(Boolean).join(" · ")}
          </p>
        ) : null}

        {goal.suggestions.length > 0 && canEdit ? (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">
              Spending in {goal.categoryName} you have not recorded yet
            </p>
            <ul className="space-y-1">
              {goal.suggestions.map((suggestion) => (
                <li
                  key={suggestion.transactionId}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {suggestion.description}
                    <span className="text-muted-foreground">
                      {suggestion.counterparty ? ` · ${suggestion.counterparty}` : ""}
                      {` · ${formatDate(suggestion.date)}`}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(suggestion.amount, currency)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === suggestion.transactionId}
                    onClick={() => recordSuggestion(suggestion)}
                  >
                    {busy === suggestion.transactionId ? (
                      <Loader2Icon className="animate-spin" />
                    ) : null}
                    Record
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {goal.contributions.length > 0 ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">
              {goal.contributionCount} contribution{goal.contributionCount === 1 ? "" : "s"}
              {goal.contributions.length < goal.contributionCount
                ? `, showing the ${goal.contributions.length} most recent`
                : ""}
            </p>
            <ul>
              {goal.contributions.map((contribution) => (
                <li
                  key={contribution.id}
                  className="flex items-center justify-between gap-2 py-0.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {formatDate(contribution.date)}
                    {contribution.note ? (
                      <span className="text-muted-foreground"> · {contribution.note}</span>
                    ) : null}
                    {contribution.fromTransaction ? (
                      <span className="text-muted-foreground"> · from a transaction</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(contribution.amount, currency)}
                  </span>
                  {canEdit ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive size-7"
                      disabled={busy === contribution.id}
                      onClick={() => removeContribution(contribution.id)}
                      aria-label={`Remove contribution of ${formatCurrency(contribution.amount, currency)}`}
                    >
                      {busy === contribution.id ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <Trash2Icon />
                      )}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>

      <ContributionDialog
        open={contributionOpen}
        onOpenChange={setContributionOpen}
        goalId={goal.id}
        goalName={goal.name}
      />
    </Card>
  );
}
