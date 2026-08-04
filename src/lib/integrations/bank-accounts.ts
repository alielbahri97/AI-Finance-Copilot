import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Per-account rows inside a bank connection. Bank syncs used to keep account
 * ids, labels and balance snapshots in the connection's metadata blob, which
 * made "total cash across every account" impossible to query and left the user
 * no way to leave one account out. They live in bank_accounts now.
 */

export interface BankAccountSnapshot {
  externalAccountId: string;
  name?: string | null;
  /** Masked identifier for the UI ("…1234"); never the full IBAN. */
  mask?: string | null;
  currency?: string | null;
  balance?: number | null;
  balanceAt?: Date | null;
  balanceType?: string | null;
}

/**
 * Records what a sync learned about a connection's accounts. `includeInTotals`
 * is never touched after creation — it is the user's choice, not the bank's.
 */
export async function recordBankAccounts(
  connectionId: string,
  accounts: BankAccountSnapshot[]
): Promise<void> {
  for (const account of accounts) {
    const balanceFields = {
      ...(account.balance !== undefined && account.balance !== null
        ? {
            lastBalance: account.balance,
            lastBalanceAt: account.balanceAt ?? new Date(),
            balanceType: account.balanceType ?? null,
          }
        : {}),
    };
    const labelFields = {
      ...(account.name !== undefined ? { name: account.name } : {}),
      ...(account.mask !== undefined ? { mask: account.mask } : {}),
      ...(account.currency !== undefined ? { currency: account.currency } : {}),
    };

    await prisma.bankAccount.upsert({
      where: {
        connectionId_externalAccountId: {
          connectionId,
          externalAccountId: account.externalAccountId,
        },
      },
      update: { ...labelFields, ...balanceFields },
      create: {
        connectionId,
        externalAccountId: account.externalAccountId,
        ...labelFields,
        ...balanceFields,
      },
    });
  }
}

/** Flips one account in or out of the aggregated totals. */
export async function setAccountIncluded(
  accountId: string,
  includeInTotals: boolean
): Promise<void> {
  await prisma.bankAccount.update({
    where: { id: accountId },
    data: { includeInTotals },
  });
}

/**
 * Verifies an account belongs to the connection the request is about. The
 * connection itself is already known to be in the caller's workspace, so this
 * is the tighter of the two checks: it also stops one connection's request from
 * touching another's account.
 */
export async function accountBelongsToConnection(
  accountId: string,
  connectionId: string
): Promise<boolean> {
  const account = await prisma.bankAccount.findFirst({
    where: { id: accountId, connectionId },
    select: { id: true },
  });
  return account !== null;
}
