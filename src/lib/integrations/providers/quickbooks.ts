import "server-only";

import { upsertSyncedInvoices, type SyncedInvoice } from "../invoice-sync";
import { IntegrationAuthError, IntegrationError } from "../oauth";

import type { ProviderHooks, SyncContext, SyncStats } from "./types";

/**
 * QuickBooks Online: OAuth2 (the callback carries the company realmId),
 * bills and invoices pulled through the query endpoint.
 */

function qbBase(): string {
  return (process.env.QUICKBOOKS_ENV || "production").toLowerCase() === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

interface QbRef {
  value: string;
  name?: string;
}

interface QbBill {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  VendorRef?: QbRef;
  CurrencyRef?: QbRef;
}

interface QbInvoice {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  CustomerRef?: QbRef;
  CurrencyRef?: QbRef;
}

async function qbQuery<T>(
  realmId: string,
  accessToken: string,
  query: string,
  entityKey: string
): Promise<T[]> {
  const url = `${qbBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=75`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationAuthError("QuickBooks token rejected; reconnect required");
  }
  if (!response.ok) {
    throw new IntegrationError(`QuickBooks query failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    QueryResponse?: Record<string, unknown>;
  };
  return ((body.QueryResponse?.[entityKey] as T[] | undefined) ?? []) as T[];
}

async function afterConnect({
  tokens,
  query,
}: {
  userId: string;
  tokens: { raw: Record<string, unknown> };
  query: Record<string, string>;
}) {
  const realmId = query.realmId;
  if (!realmId) {
    throw new IntegrationError("QuickBooks callback did not include a realmId");
  }
  void tokens;
  return { externalId: realmId, metadata: { realmId } };
}

async function sync(ctx: SyncContext): Promise<SyncStats> {
  if (!ctx.accessToken) {
    throw new IntegrationAuthError("QuickBooks connection has no access token");
  }
  const realmId = ctx.metadata.realmId as string | undefined;
  if (!realmId) {
    throw new IntegrationAuthError("QuickBooks connection has no realmId; reconnect");
  }

  const [bills, invoices] = await Promise.all([
    qbQuery<QbBill>(realmId, ctx.accessToken, "select * from Bill MAXRESULTS 200", "Bill"),
    qbQuery<QbInvoice>(
      realmId,
      ctx.accessToken,
      "select * from Invoice MAXRESULTS 200",
      "Invoice"
    ),
  ]);

  const synced: SyncedInvoice[] = [
    ...bills.map(
      (bill): SyncedInvoice => ({
        externalRef: `quickbooks:bill:${bill.Id}`,
        vendor: bill.VendorRef?.name ?? "QuickBooks vendor",
        invoiceNumber: bill.DocNumber ?? null,
        invoiceDate: bill.TxnDate ?? null,
        dueDate: bill.DueDate ?? null,
        currency: bill.CurrencyRef?.value ?? ctx.currency,
        total: bill.TotalAmt ?? 0,
        direction: "PAYABLE",
        status: (bill.Balance ?? 0) > 0 ? "UNPAID" : "PAID",
      })
    ),
    ...invoices.map(
      (invoice): SyncedInvoice => ({
        externalRef: `quickbooks:invoice:${invoice.Id}`,
        vendor: invoice.CustomerRef?.name ?? "QuickBooks customer",
        invoiceNumber: invoice.DocNumber ?? null,
        invoiceDate: invoice.TxnDate ?? null,
        dueDate: invoice.DueDate ?? null,
        currency: invoice.CurrencyRef?.value ?? ctx.currency,
        total: invoice.TotalAmt ?? 0,
        direction: "RECEIVABLE",
        status: (invoice.Balance ?? 0) > 0 ? "UNPAID" : "PAID",
      })
    ),
  ];

  const result = await upsertSyncedInvoices(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    synced
  );
  return {
    bills: bills.length,
    invoices: invoices.length,
    created: result.created,
    updated: result.updated,
  };
}

export const quickbooksHooks: ProviderHooks = { afterConnect, sync };
