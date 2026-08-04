import "server-only";
import { cache } from "react";

import type { SavingsContribution, SavingsGoal } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import {
  projectGoal,
  summarizeGoals,
  type GoalContribution,
  type GoalProjection,
  type GoalsSummary,
} from "./goals";

/**
 * The database boundary for savings goals. Everything above this file works in
 * plain numbers and Dates: Prisma `Decimal` is converted here and never handed
 * to a component, and every query is scoped by `workspaceId`.
 */

/** Contributions listed per goal. The projection still uses every one of them. */
const RECENT_CONTRIBUTIONS = 5;

/** Most-recent candidate transactions offered per goal. */
const MAX_SUGGESTIONS = 20;

export interface GoalContributionRow {
  id: string;
  amount: number;
  date: Date;
  note: string | null;
  /** Set when the contribution was recorded from a bank transaction. */
  transactionId: string | null;
}

/**
 * A transaction in the goal's linked category that has not been recorded as a
 * contribution yet, so the UI can offer it as a one-click deposit.
 */
export interface SuggestedContribution {
  transactionId: string;
  description: string;
  counterparty: string | null;
  amount: number;
  date: Date;
}

export interface GoalDetail {
  projection: GoalProjection;
  startingAmount: number;
  note: string | null;
  categoryId: string | null;
  categoryName: string | null;
  bankAccountId: string | null;
  bankAccountLabel: string | null;
  achievedAt: Date | null;
  archivedAt: Date | null;
  recentContributions: GoalContributionRow[];
  suggestions: SuggestedContribution[];
}

/** A category or account a goal can be linked to, for the goal form. */
export interface GoalLinkOption {
  id: string;
  label: string;
}

export interface GoalsOverview {
  /** Active goals only: an archived goal is history and must not move a total. */
  summary: GoalsSummary;
  /** Active goals, in `summary.goals` order. */
  goals: GoalDetail[];
  archived: GoalDetail[];
  categories: GoalLinkOption[];
  bankAccounts: GoalLinkOption[];
}

/** The API shape of a goal row, with money as numbers. */
export interface GoalRecord {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: Date | null;
  startingAmount: number;
  categoryId: string | null;
  bankAccountId: string | null;
  note: string | null;
  achievedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export function toGoalRecord(row: SavingsGoal): GoalRecord {
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.targetAmount.toNumber(),
    targetDate: row.targetDate,
    startingAmount: row.startingAmount.toNumber(),
    categoryId: row.categoryId,
    bankAccountId: row.bankAccountId,
    note: row.note,
    achievedAt: row.achievedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
  };
}

export function toContributionRecord(row: SavingsContribution): GoalContributionRow {
  return {
    id: row.id,
    amount: row.amount.toNumber(),
    date: row.date,
    note: row.note,
    transactionId: row.transactionId,
  };
}

type GoalWithRelations = SavingsGoal & {
  category: { name: string } | null;
  bankAccount: { name: string | null; mask: string | null } | null;
  contributions: SavingsContribution[];
};

function accountLabel(account: { name: string | null; mask: string | null }): string {
  return account.mask || account.name || "Account";
}

/**
 * Candidate contributions for one goal: recent expenses in its linked category
 * that no contribution of this goal points at yet. Bounded to the most recent
 * `MAX_SUGGESTIONS`, because this is a prompt, not a ledger.
 */
async function loadSuggestions(
  workspaceId: string,
  goal: GoalWithRelations
): Promise<SuggestedContribution[]> {
  if (!goal.categoryId) return [];

  const alreadyRecorded = goal.contributions
    .map((contribution) => contribution.transactionId)
    .filter((id): id is string => id !== null);

  const transactions = await prisma.transaction.findMany({
    where: {
      workspaceId,
      type: "EXPENSE",
      categoryId: goal.categoryId,
      ...(alreadyRecorded.length > 0 ? { id: { notIn: alreadyRecorded } } : {}),
    },
    orderBy: { date: "desc" },
    take: MAX_SUGGESTIONS,
    select: { id: true, description: true, counterparty: true, amount: true, date: true },
  });

  return transactions.map((transaction) => ({
    transactionId: transaction.id,
    description: transaction.description,
    counterparty: transaction.counterparty,
    amount: transaction.amount.toNumber(),
    date: transaction.date,
  }));
}

function toDetail(goal: GoalWithRelations, now: Date): Omit<GoalDetail, "suggestions"> {
  const contributions: GoalContribution[] = goal.contributions.map((contribution) => ({
    amount: contribution.amount.toNumber(),
    date: contribution.date,
  }));

  const projection = projectGoal(
    {
      id: goal.id,
      name: goal.name,
      targetAmount: goal.targetAmount.toNumber(),
      targetDate: goal.targetDate,
      startingAmount: goal.startingAmount.toNumber(),
      createdAt: goal.createdAt,
      achievedAt: goal.achievedAt,
    },
    contributions,
    now
  );

  return {
    projection,
    startingAmount: goal.startingAmount.toNumber(),
    note: goal.note,
    categoryId: goal.categoryId,
    categoryName: goal.category?.name ?? null,
    bankAccountId: goal.bankAccountId,
    bankAccountLabel: goal.bankAccount ? accountLabel(goal.bankAccount) : null,
    achievedAt: goal.achievedAt,
    archivedAt: goal.archivedAt,
    recentContributions: [...goal.contributions]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, RECENT_CONTRIBUTIONS)
      .map(toContributionRecord),
  };
}

/**
 * Every goal in the workspace with its progress, projection and the totals the
 * page and the dashboard widget both render. Request-memoized: the page and a
 * widget on the same render ask for the same figures.
 */
export const getGoalsOverview = cache(async (workspaceId: string): Promise<GoalsOverview> => {
  const now = new Date();

  const [goals, categories, bankAccounts] = await Promise.all([
    prisma.savingsGoal.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        category: { select: { name: true } },
        bankAccount: { select: { name: true, mask: true } },
        // Unbounded on purpose: the saving rate is an average over the goal's
        // whole history, so a truncated list would report the wrong projection.
        contributions: { orderBy: { date: "desc" } },
      },
    }),
    prisma.category.findMany({
      where: { workspaceId, type: "EXPENSE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.bankAccount.findMany({
      where: { connection: { workspaceId } },
      orderBy: [{ connectionId: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        mask: true,
        connection: { select: { displayName: true, institutionName: true, provider: true } },
      },
    }),
  ]);

  const active = goals.filter((goal) => goal.archivedAt === null);
  const suggestions = await Promise.all(
    active.map((goal) => loadSuggestions(workspaceId, goal))
  );

  const details = active.map((goal, index) => ({
    ...toDetail(goal, now),
    suggestions: suggestions[index],
  }));

  const summary = summarizeGoals(details.map((detail) => detail.projection));
  const byId = new Map(details.map((detail) => [detail.projection.id, detail]));

  return {
    summary,
    goals: summary.goals
      .map((projection) => byId.get(projection.id))
      .filter((detail): detail is GoalDetail => detail !== undefined),
    archived: goals
      .filter((goal) => goal.archivedAt !== null)
      .map((goal) => ({ ...toDetail(goal, now), suggestions: [] })),
    categories: categories.map((category) => ({ id: category.id, label: category.name })),
    bankAccounts: bankAccounts.map((account) => {
      const bank =
        account.connection.displayName ||
        account.connection.institutionName ||
        account.connection.provider;
      return { id: account.id, label: `${bank} · ${accountLabel(account)}` };
    }),
  };
});

/** Ids arriving from a client are only usable once they are known to be ours. */
export async function categoryBelongsToWorkspace(
  workspaceId: string,
  categoryId: string
): Promise<boolean> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, workspaceId },
    select: { id: true },
  });
  return category !== null;
}

export async function bankAccountBelongsToWorkspace(
  workspaceId: string,
  bankAccountId: string
): Promise<boolean> {
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, connection: { workspaceId } },
    select: { id: true },
  });
  return account !== null;
}

export async function transactionBelongsToWorkspace(
  workspaceId: string,
  transactionId: string
): Promise<boolean> {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, workspaceId },
    select: { id: true },
  });
  return transaction !== null;
}

/** A goal row's own fields, verified to be in this workspace. */
export async function findGoalInWorkspace(
  workspaceId: string,
  goalId: string
): Promise<SavingsGoal | null> {
  return prisma.savingsGoal.findFirst({ where: { id: goalId, workspaceId } });
}

/**
 * Stamps `achievedAt` the first time a goal is fully funded.
 *
 * Deliberately one-way: removing a contribution afterwards leaves the stamp
 * alone, because the goal really was funded on that date and a corrected typo
 * should not rewrite that. `projectGoal` treats a stamped goal as achieved, so
 * the badge stays put and no new projection is invented for it.
 */
export async function markAchievedIfFunded(
  workspaceId: string,
  goalId: string
): Promise<Date | null> {
  const goal = await prisma.savingsGoal.findFirst({
    where: { id: goalId, workspaceId },
    select: { achievedAt: true, targetAmount: true, startingAmount: true },
  });
  if (!goal) return null;
  if (goal.achievedAt) return goal.achievedAt;

  const contributed = await prisma.savingsContribution.aggregate({
    where: { goalId },
    _sum: { amount: true },
  });
  const saved = goal.startingAmount.toNumber() + (contributed._sum.amount?.toNumber() ?? 0);
  if (saved < goal.targetAmount.toNumber()) return null;

  const achievedAt = new Date();
  await prisma.savingsGoal.update({ where: { id: goalId }, data: { achievedAt } });
  return achievedAt;
}
