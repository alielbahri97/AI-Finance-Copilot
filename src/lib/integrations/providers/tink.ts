import "server-only";

import { importBankTransactions, type BankTransaction } from "../bank-import";
import { IntegrationAuthError, IntegrationError } from "../oauth";

import type { ProviderHooks, SyncContext, SyncStats } from "./types";

/**
 * Tink: standard OAuth2 through Tink Link, transactions from the Data API
 * (GET /data/v2/transactions, page-token pagination).
 */

interface TinkAmount {
  value: { unscaledValue: string; scale: string };
  currencyCode: string;
}

interface TinkTransaction {
  id: string;
  amount: TinkAmount;
  descriptions?: { display?: string; original?: string };
  dates?: { booked?: string; value?: string };
  counterparties?: { payee?: { name?: string }; payer?: { name?: string } };
  status: string;
}

interface TinkPage {
  transactions: TinkTransaction[];
  nextPageToken?: string;
}

function amountOf(amount: TinkAmount): number {
  const unscaled = Number(amount.value.unscaledValue);
  const scale = Number(amount.value.scale);
  return unscaled / 10 ** scale;
}

async function sync(ctx: SyncContext): Promise<SyncStats> {
  if (!ctx.accessToken) {
    throw new IntegrationAuthError("Tink connection has no access token");
  }

  const transactions: BankTransaction[] = [];
  let pageToken: string | undefined;
  let fetched = 0;

  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://api.tink.com/data/v2/transactions");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (response.status === 401 || response.status === 403) {
      throw new IntegrationAuthError("Tink token rejected; reconnect required");
    }
    if (!response.ok) {
      throw new IntegrationError(`Tink transactions request failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as TinkPage;
    fetched += body.transactions.length;

    for (const tx of body.transactions) {
      if (tx.status !== "BOOKED") continue;
      const value = amountOf(tx.amount);
      if (value === 0) continue;
      const date = tx.dates?.booked ?? tx.dates?.value;
      if (!date) continue;
      transactions.push({
        externalId: tx.id,
        date,
        description:
          tx.descriptions?.display || tx.descriptions?.original || "Tink transaction",
        counterparty:
          tx.counterparties?.payee?.name ?? tx.counterparties?.payer?.name ?? null,
        amount: Math.abs(value),
        type: value < 0 ? "EXPENSE" : "INCOME",
      });
    }

    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  const result = await importBankTransactions(
    ctx.userId,
    ctx.currency,
    "tink",
    `Tink sync ${new Date().toISOString().slice(0, 10)}`,
    transactions
  );

  return { fetched, imported: result.imported, duplicates: result.duplicates };
}

export const tinkHooks: ProviderHooks = { sync };
