import "server-only";

import type { Assumption } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { loadCashPosition } from "./cash-data";
import {
  computeForecast,
  type AssumptionInput,
  type ForecastInputs,
  type ForecastResult,
} from "./forecast";
import type { FinanceTransaction } from "./recurrence";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Converts a Prisma assumption row (Decimal fields) into engine input. */
export function mapAssumptionRow(row: Assumption): AssumptionInput {
  return {
    id: row.id,
    kind: row.kind,
    type: row.type,
    label: row.label,
    amount: row.amount === null ? null : Number(row.amount),
    percent: row.percent === null ? null : Number(row.percent),
    date: row.date,
    startDate: row.startDate,
    endDate: row.endDate,
    enabled: row.enabled,
  };
}

/** Everything `computeForecast` needs except the assumptions to apply. */
export type ForecastBaseInputs = Omit<ForecastInputs, "assumptions">;

/**
 * Loads the history, the opening balance and the bank-anchored current balance.
 * Separated from `buildForecast` because scenario comparison runs the engine
 * two or three times over the *same* history with different assumptions — this
 * is the part that costs database round-trips, and it is loaded once.
 */
export async function loadForecastInputs(
  workspaceId: string,
  currency: string
): Promise<ForecastBaseInputs> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 370 * MS_PER_DAY);

  const [rows, priorRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { workspaceId, date: { gte: windowStart } },
      orderBy: { date: "asc" },
      select: {
        type: true,
        amount: true,
        date: true,
        description: true,
        counterparty: true,
        category: { select: { name: true } },
      },
    }),
    prisma.transaction.findMany({
      where: { workspaceId, date: { lt: windowStart } },
      select: { type: true, amount: true },
    }),
  ]);

  const transactions: FinanceTransaction[] = rows.map((row) => ({
    type: row.type,
    amount: Number(row.amount),
    date: row.date,
    description: row.description,
    counterparty: row.counterparty,
    category: row.category?.name ?? "Uncategorized",
  }));

  const priorNet = priorRows.reduce(
    (sum, row) => sum + (row.type === "INCOME" ? Number(row.amount) : -Number(row.amount)),
    0
  );

  const windowNet = transactions.reduce(
    (sum, tx) => sum + (tx.type === "INCOME" ? tx.amount : -tx.amount),
    0
  );
  const cash = await loadCashPosition(workspaceId, currency, priorNet + windowNet);

  return {
    transactions,
    priorNet,
    currency,
    now,
    startingBalance: cash.source === "bank" ? cash.total : null,
  };
}

/**
 * The assumptions "the forecast" means when nobody named a scenario: the ones
 * in the workspace's default scenario, or — for every workspace that has never
 * created one — the base scenario's, which is the `scenario_id IS NULL` set
 * that predates scenarios entirely. So the dashboard, the digests, the alerts
 * and the copilot all read the same projection the forecast page opens on,
 * and a workspace with no scenarios sees precisely what it always saw.
 */
export async function loadDefaultScenarioAssumptions(workspaceId: string): Promise<Assumption[]> {
  const preferred = await prisma.scenario.findFirst({
    where: { workspaceId, isDefault: true },
    select: { id: true },
  });
  return prisma.assumption.findMany({
    where: { workspaceId, scenarioId: preferred?.id ?? null },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Loads the workspace's transactions and assumptions and computes the
 * forecast. Pass `preloadedAssumptions` when the caller already fetched the
 * rows (e.g. the forecast page shows them too) to avoid a duplicate query.
 */
export async function buildForecast(
  workspaceId: string,
  currency: string,
  preloadedAssumptions?: Assumption[]
): Promise<ForecastResult> {
  const [base, assumptionRows] = await Promise.all([
    loadForecastInputs(workspaceId, currency),
    preloadedAssumptions ?? loadDefaultScenarioAssumptions(workspaceId),
  ]);

  return computeForecast({ ...base, assumptions: assumptionRows.map(mapAssumptionRow) });
}
