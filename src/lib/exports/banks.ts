import { loadCashPosition } from "@/lib/finance/cash-data";
import { prisma } from "@/lib/prisma";

import { csvLines } from "./csv";

export async function buildBankBalancesCsv(workspaceId: string, currency: string): Promise<string> {
  const income = await prisma.transaction.aggregate({
    where: { workspaceId, type: "INCOME" },
    _sum: { amount: true },
  });
  const expense = await prisma.transaction.aggregate({
    where: { workspaceId, type: "EXPENSE" },
    _sum: { amount: true },
  });
  const transactionBalance = Number(income._sum.amount ?? 0) - Number(expense._sum.amount ?? 0);
  const position = await loadCashPosition(workspaceId, currency, transactionBalance);

  return csvLines([
    ["Workspace currency", currency],
    ["Combined total", position.total],
    ["Source", position.source],
    ["Transaction-derived balance", transactionBalance],
    [],
    [
      "Account",
      "Connection",
      "Currency",
      "Balance",
      "Balance as of",
      "Included in totals",
    ],
    ...position.accounts.map((account) => [
      account.label,
      account.connectionLabel,
      account.currency,
      account.balance,
      account.balanceAt,
      account.includeInTotals,
    ]),
  ]);
}
