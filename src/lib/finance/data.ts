import "server-only";

import type { Assumption } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { computeForecast, type AssumptionInput, type ForecastResult } from "./forecast";
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

/** Loads the user's transactions and assumptions and computes the forecast. */
export async function buildForecast(userId: string, currency: string): Promise<ForecastResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 370 * MS_PER_DAY);

  const [rows, priorRows, assumptionRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, date: { gte: windowStart } },
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
      where: { userId, date: { lt: windowStart } },
      select: { type: true, amount: true },
    }),
    prisma.assumption.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
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

  return computeForecast({
    transactions,
    priorNet,
    assumptions: assumptionRows.map(mapAssumptionRow),
    currency,
    now,
  });
}
