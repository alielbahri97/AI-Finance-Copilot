import type { GoalStatus } from "@/lib/personal/goals";

/**
 * What the client components receive: the projection already computed on the
 * server, with dates as ISO strings so the props cross the boundary as plain
 * JSON and the date inputs have something to bind to.
 */

export interface GoalContributionItem {
  id: string;
  amount: number;
  date: string;
  note: string | null;
  /** Recorded from a bank transaction rather than typed in. */
  fromTransaction: boolean;
}

export interface GoalSuggestionItem {
  transactionId: string;
  description: string;
  counterparty: string | null;
  amount: number;
  date: string;
}

/** A category or account the goal can be linked to. */
export interface GoalOption {
  id: string;
  label: string;
}

export interface GoalCardData {
  id: string;
  name: string;
  note: string | null;
  targetAmount: number;
  startingAmount: number;
  /** ISO date, also used as the value of the date input. */
  targetDate: string | null;
  categoryId: string | null;
  categoryName: string | null;
  bankAccountId: string | null;
  bankAccountLabel: string | null;
  archived: boolean;
  saved: number;
  remaining: number;
  /** 0–1. */
  progress: number;
  monthlyRate: number;
  requiredMonthlyRate: number | null;
  monthsRemaining: number | null;
  projectedCompletion: string | null;
  status: GoalStatus;
  contributionCount: number;
  achievedAt: string | null;
  contributions: GoalContributionItem[];
  suggestions: GoalSuggestionItem[];
}
