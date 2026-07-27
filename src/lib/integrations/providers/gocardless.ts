import "server-only";

import { createHash } from "node:crypto";

import { importBankTransactions, type BankTransaction } from "../bank-import";
import { IntegrationAuthError, IntegrationError, appUrl } from "../oauth";

import type { ProviderHooks, SyncContext, SyncStats } from "./types";

/**
 * GoCardless Bank Account Data (ex-Nordigen). No per-user OAuth tokens:
 * API access tokens are minted from the secret id/key, and the user approves
 * a *requisition* at their bank. We store the requisition + account ids in
 * connection metadata and fetch a fresh API token on every sync.
 */

const BASE = "https://bankaccountdata.gocardless.com/api/v2";

async function apiToken(): Promise<string> {
  const secretId = process.env.GOCARDLESS_SECRET_ID;
  const secretKey = process.env.GOCARDLESS_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new IntegrationError("GoCardless is not configured");
  }
  const response = await fetch(`${BASE}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }),
  });
  if (!response.ok) {
    throw new IntegrationError(`GoCardless token request failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { access: string };
  return body.access;
}

async function gcFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationAuthError(`GoCardless auth failed on ${path}`);
  }
  if (!response.ok) {
    throw new IntegrationError(`GoCardless ${path} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Creates an end-user agreement + requisition; returns the approval link. */
export async function createRequisition(
  institutionId: string,
  reference: string
): Promise<{ requisitionId: string; link: string }> {
  const token = await apiToken();
  const requisition = await gcFetch<{ id: string; link: string }>("/requisitions/", token, {
    method: "POST",
    body: JSON.stringify({
      redirect: `${appUrl()}/api/integrations/gocardless/callback`,
      institution_id: institutionId,
      reference,
      user_language: "EN",
    }),
  });
  return { requisitionId: requisition.id, link: requisition.link };
}

/** Fetches the requisition after user approval to get the linked accounts. */
export async function finalizeRequisition(
  requisitionId: string
): Promise<{ accounts: string[]; institutionId: string }> {
  const token = await apiToken();
  const requisition = await gcFetch<{
    accounts: string[];
    status: string;
    institution_id: string;
  }>(`/requisitions/${requisitionId}/`, token);
  if (requisition.status !== "LN" || requisition.accounts.length === 0) {
    throw new IntegrationError(
      "The bank connection was not completed. Try connecting again."
    );
  }
  return { accounts: requisition.accounts, institutionId: requisition.institution_id };
}

interface GcTransaction {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  remittanceInformationUnstructured?: string;
  creditorName?: string;
  debtorName?: string;
}

function externalIdOf(accountId: string, tx: GcTransaction): string {
  const explicit = tx.transactionId ?? tx.internalTransactionId;
  if (explicit) return `${accountId}:${explicit}`;
  const digest = createHash("sha256")
    .update(
      [
        accountId,
        tx.bookingDate ?? "",
        tx.transactionAmount.amount,
        tx.remittanceInformationUnstructured ?? "",
      ].join("|")
    )
    .digest("hex");
  return `${accountId}:${digest}`;
}

async function sync(ctx: SyncContext): Promise<SyncStats> {
  const accounts = (ctx.metadata.accounts as string[] | undefined) ?? [];
  if (accounts.length === 0) {
    throw new IntegrationAuthError("No linked bank accounts; reconnect required");
  }

  const token = await apiToken();
  const transactions: BankTransaction[] = [];
  let fetched = 0;

  for (const accountId of accounts) {
    const body = await gcFetch<{ transactions: { booked: GcTransaction[] } }>(
      `/accounts/${accountId}/transactions/`,
      token
    );
    for (const tx of body.transactions.booked) {
      const amount = Number(tx.transactionAmount.amount);
      const date = tx.bookingDate ?? tx.valueDate;
      if (!date || !Number.isFinite(amount) || amount === 0) continue;
      fetched += 1;
      transactions.push({
        externalId: externalIdOf(accountId, tx),
        date,
        description:
          tx.remittanceInformationUnstructured ||
          tx.creditorName ||
          tx.debtorName ||
          "Bank transaction",
        counterparty: (amount < 0 ? tx.creditorName : tx.debtorName) ?? null,
        amount: Math.abs(amount),
        type: amount < 0 ? "EXPENSE" : "INCOME",
      });
    }
  }

  const result = await importBankTransactions(
    ctx.userId,
    ctx.currency,
    "gocardless",
    `GoCardless sync ${new Date().toISOString().slice(0, 10)}`,
    transactions
  );

  return { fetched, imported: result.imported, duplicates: result.duplicates };
}

export const gocardlessHooks: ProviderHooks = { sync };
