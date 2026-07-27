import "server-only";

import { importBankTransactions, type BankTransaction } from "../bank-import";
import { IntegrationAuthError, IntegrationError } from "../oauth";

import type { ProviderHooks, SyncContext, SyncStats } from "./types";

/**
 * Plaid uses its Link flow instead of OAuth2: the client opens Plaid Link
 * with a server-created link token; the resulting public token is exchanged
 * server-side for a permanent access token. Transactions are pulled with the
 * cursor-based /transactions/sync endpoint.
 */

function plaidBase(): string {
  const env = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  return env === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com";
}

function credentials(): { client_id: string; secret: string } {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new IntegrationError("Plaid is not configured (PLAID_CLIENT_ID / PLAID_SECRET)");
  }
  return { client_id: clientId, secret };
}

async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${plaidBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...credentials(), ...body }),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = (json.error_code as string) ?? `HTTP ${response.status}`;
    const message = `Plaid ${path} failed: ${code}`;
    if (code === "ITEM_LOGIN_REQUIRED" || code === "INVALID_ACCESS_TOKEN") {
      throw new IntegrationAuthError(message);
    }
    throw new IntegrationError(message);
  }
  return json as T;
}

export async function createPlaidLinkToken(userId: string): Promise<string> {
  const result = await plaidPost<{ link_token: string }>("/link/token/create", {
    user: { client_user_id: userId },
    client_name: "FinPilot",
    products: ["transactions"],
    country_codes: (process.env.PLAID_COUNTRY_CODES || "US").split(",").map((c) => c.trim()),
    language: "en",
  });
  return result.link_token;
}

export async function exchangePlaidPublicToken(
  publicToken: string
): Promise<{ accessToken: string; itemId: string }> {
  const result = await plaidPost<{ access_token: string; item_id: string }>(
    "/item/public_token/exchange",
    { public_token: publicToken }
  );
  return { accessToken: result.access_token, itemId: result.item_id };
}

interface PlaidTransaction {
  transaction_id: string;
  date: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  pending: boolean;
  iso_currency_code?: string | null;
}

interface PlaidSyncResponse {
  added: PlaidTransaction[];
  next_cursor: string;
  has_more: boolean;
}

async function sync(ctx: SyncContext): Promise<SyncStats> {
  if (!ctx.accessToken) {
    throw new IntegrationAuthError("Plaid connection has no access token");
  }

  let cursor = (ctx.metadata.plaidCursor as string | undefined) ?? undefined;
  const added: PlaidTransaction[] = [];
  let hasMore = true;
  let pages = 0;

  while (hasMore && pages < 20) {
    const page = await plaidPost<PlaidSyncResponse>("/transactions/sync", {
      access_token: ctx.accessToken,
      cursor,
      count: 250,
    });
    added.push(...page.added);
    cursor = page.next_cursor;
    hasMore = page.has_more;
    pages += 1;
  }

  // Plaid convention: positive amounts are money leaving the account.
  const transactions: BankTransaction[] = added
    .filter((tx) => !tx.pending && tx.amount !== 0)
    .map((tx) => ({
      externalId: tx.transaction_id,
      date: tx.date,
      description: tx.merchant_name || tx.name,
      counterparty: tx.merchant_name ?? null,
      amount: Math.abs(tx.amount),
      type: tx.amount > 0 ? "EXPENSE" : "INCOME",
    }));

  const result = await importBankTransactions(
    ctx.userId,
    ctx.currency,
    "plaid",
    `Plaid sync ${new Date().toISOString().slice(0, 10)}`,
    transactions
  );
  await ctx.patchMetadata({ plaidCursor: cursor ?? null });

  return { fetched: added.length, imported: result.imported, duplicates: result.duplicates };
}

async function revoke(
  _connection: unknown,
  accessToken: string | null
): Promise<void> {
  if (!accessToken) return;
  await plaidPost("/item/remove", { access_token: accessToken }).catch((error) =>
    console.error("[integrations] Plaid item removal failed:", error)
  );
}

export const plaidHooks: ProviderHooks = { sync, revoke };
