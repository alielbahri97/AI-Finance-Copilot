import "server-only";
import { cache } from "react";

import { isSchemaOutOfDate } from "@/lib/db-errors";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { computeCashPosition, type CashAccountInput, type CashPosition } from "./cash";

/**
 * Loads every bank account across the workspace's bank connections and turns
 * them into the aggregated cash position. Request-memoized: the dashboard's
 * cash card, its balance chart, the forecast and the reports page all ask for
 * the same figure within one render.
 */
export const loadCashPosition = cache(
  async (
    workspaceId: string,
    currency: string,
    transactionBalance: number
  ): Promise<CashPosition> => {
    const accounts = await loadBankAccounts(workspaceId);
    return computeCashPosition({ accounts, transactionBalance, currency });
  }
);

/** Connection label preference: what the user named it, else the bank's name. */
function connectionLabel(connection: {
  displayName: string | null;
  institutionName: string | null;
  provider: string;
}): string {
  return connection.displayName || connection.institutionName || connection.provider;
}

async function loadBankAccounts(workspaceId: string): Promise<CashAccountInput[]> {
  try {
    const rows = await prisma.bankAccount.findMany({
      where: { connection: { workspaceId } },
      include: {
        connection: {
          select: { id: true, provider: true, displayName: true, institutionName: true },
        },
      },
      orderBy: [{ connectionId: "asc" }, { createdAt: "asc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      connectionId: row.connection.id,
      connectionLabel: connectionLabel(row.connection),
      label: row.mask || row.name || "Account",
      currency: row.currency,
      balance: row.lastBalance === null ? null : Number(row.lastBalance),
      balanceAt: row.lastBalanceAt?.toISOString() ?? null,
      includeInTotals: row.includeInTotals,
    }));
  } catch (error) {
    // The code can go live before 0016 is applied; until then there simply are
    // no bank accounts and cash falls back to the transaction-derived balance.
    if (isSchemaOutOfDate(error)) {
      logger.warn("[cash] bank_accounts not available yet; using transaction balance", {
        error: serializeError(error),
      });
      return [];
    }
    throw error;
  }
}
