import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LockIcon } from "lucide-react";

import { GoalsBodySkeleton } from "@/components/goals/goal-skeletons";
import { GoalsManager } from "@/components/goals/goals-manager";
import { GoalsSummaryCard } from "@/components/goals/goals-summary";
import type { GoalCardData } from "@/components/goals/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
import { getEntitlements } from "@/lib/billing/entitlements";
import { EDITION_PLAN_ORDER, getPlan } from "@/lib/billing/plans";
import { getGoalsOverview, type GoalDetail } from "@/lib/personal/goals-data";
import { getWorkspaceContext } from "@/lib/workspace/context";
import { editionHasFeature } from "@/lib/workspace/editions";

export const metadata: Metadata = { title: "Savings goals" };
export const dynamic = "force-dynamic";

/** Date inputs and the shared date formatter both want a plain calendar day. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toCardData(detail: GoalDetail): GoalCardData {
  const projection = detail.projection;
  return {
    id: projection.id,
    name: projection.name,
    note: detail.note,
    targetAmount: projection.targetAmount,
    startingAmount: detail.startingAmount,
    targetDate: projection.targetDate ? isoDay(projection.targetDate) : null,
    categoryId: detail.categoryId,
    categoryName: detail.categoryName,
    bankAccountId: detail.bankAccountId,
    bankAccountLabel: detail.bankAccountLabel,
    archived: detail.archivedAt !== null,
    saved: projection.saved,
    remaining: projection.remaining,
    progress: projection.progress,
    monthlyRate: projection.monthlyRate,
    requiredMonthlyRate: projection.requiredMonthlyRate,
    monthsRemaining: projection.monthsRemaining,
    projectedCompletion: projection.projectedCompletion
      ? isoDay(projection.projectedCompletion)
      : null,
    status: projection.status,
    contributionCount: projection.contributionCount,
    achievedAt: detail.achievedAt ? isoDay(detail.achievedAt) : null,
    contributions: detail.recentContributions.map((contribution) => ({
      id: contribution.id,
      amount: contribution.amount,
      date: isoDay(contribution.date),
      note: contribution.note,
      fromTransaction: contribution.transactionId !== null,
    })),
    suggestions: detail.suggestions.map((suggestion) => ({
      transactionId: suggestion.transactionId,
      description: suggestion.description,
      counterparty: suggestion.counterparty,
      amount: suggestion.amount,
      date: isoDay(suggestion.date),
    })),
  };
}

function PageHeader() {
  return (
    <div>
      <PageHeading>Savings goals</PageHeading>
      <p className="text-muted-foreground text-sm">
        What you are saving for, how far along you are, and when you get there at the rate you
        are actually saving.
      </p>
    </div>
  );
}

/** Streams: the header paints first, the plan check and the goals follow. */
export default async function GoalsPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  // In a Business workspace the feature does not exist, so neither does the URL.
  if (!editionHasFeature(ctx.workspace.type, "goals")) notFound();
  if (!ctx.permissions.has("view_reports")) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <PageHeader />
      <Suspense fallback={<GoalsBodySkeleton />}>
        <GoalsBody
          workspaceId={ctx.workspace.id}
          currency={ctx.workspace.currency}
          canEdit={ctx.permissions.has("edit_transactions")}
        />
      </Suspense>
    </div>
  );
}

interface GoalsBodyProps {
  workspaceId: string;
  currency: string;
  canEdit: boolean;
}

async function GoalsBody({ workspaceId, currency, canEdit }: GoalsBodyProps) {
  const entitlements = await getEntitlements(workspaceId);

  // The edition allows goals but the plan does not include them: the page still
  // exists and explains itself rather than pretending to be missing.
  if (!entitlements.plan.limits.goalsEnabled) {
    const upgradeTo = EDITION_PLAN_ORDER[entitlements.edition]
      .map((planId) => getPlan(planId, entitlements.edition))
      .find((plan) => plan.limits.goalsEnabled);

    return (
      <>
        <Alert>
          <LockIcon className="size-4" />
          <AlertTitle>
            Savings goals are part of {upgradeTo?.name ?? "the paid plans"}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>
              Your current plan is {entitlements.plan.name}. Everything else you have keeps
              working exactly as it does now.
            </span>
            <Button asChild size="sm">
              <Link href="/billing">Upgrade plan</Link>
            </Button>
          </AlertDescription>
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle>What you get</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
              <li>Named goals with a target amount and, if you want one, a target date.</li>
              <li>Contributions tracked per goal, with the running progress.</li>
              <li>
                A projected completion date from your average saving rate, and the monthly
                amount a target date actually asks of you.
              </li>
              <li>
                Goals linked to a spending category, so deposits can be recorded from your
                bank transactions in one click.
              </li>
            </ul>
          </CardContent>
        </Card>
      </>
    );
  }

  const overview = await getGoalsOverview(workspaceId);

  return (
    <>
      {overview.goals.length > 0 ? (
        <GoalsSummaryCard summary={overview.summary} currency={currency} />
      ) : null}

      <GoalsManager
        goals={overview.goals.map(toCardData)}
        archived={overview.archived.map(toCardData)}
        categories={overview.categories}
        accounts={overview.bankAccounts}
        currency={currency}
        canEdit={canEdit}
      />
    </>
  );
}
