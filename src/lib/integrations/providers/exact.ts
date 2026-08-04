import "server-only";

import { upsertSyncedInvoices, type SyncedInvoice } from "../invoice-sync";
import { IntegrationAuthError, IntegrationError, type TokenSet } from "../oauth";

import type { ProviderHooks, SyncContext, SyncStats } from "./types";

/**
 * Exact Online: OAuth2 against the regional endpoint (EXACT_REGION, default
 * start.exactonline.nl). The current division is discovered after connect;
 * sales invoices map to receivables and purchase entries to payables.
 */

function base(): string {
  return `https://${process.env.EXACT_REGION || "start.exactonline.nl"}`;
}

function exactDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /\/Date\((\d+)/.exec(value);
  if (match) return new Date(Number(match[1])).toISOString().slice(0, 10);
  return value.slice(0, 10);
}

async function exactGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${base()}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationAuthError("Exact Online token rejected; reconnect required");
  }
  if (!response.ok) {
    throw new IntegrationError(`Exact Online ${path} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

interface ExactEnvelope<T> {
  d: { results: T[] };
}

async function afterConnect({ tokens }: { userId: string; tokens: TokenSet }) {
  const me = await exactGet<ExactEnvelope<{ CurrentDivision: number }>>(
    "/api/v1/current/Me?$select=CurrentDivision",
    tokens.accessToken
  );
  const division = me.d.results[0]?.CurrentDivision;
  if (!division) {
    throw new IntegrationError("Could not determine the Exact Online division");
  }
  return { metadata: { division } };
}

interface ExactSalesInvoice {
  InvoiceID: string;
  InvoiceNumber?: number;
  InvoiceDate?: string;
  DueDate?: string;
  AmountDC?: number;
  Currency?: string;
  InvoiceToName?: string;
}

interface ExactPurchaseEntry {
  EntryID: string;
  EntryNumber?: number;
  EntryDate?: string;
  DueDate?: string;
  AmountDC?: number;
  Currency?: string;
  Description?: string;
}

async function sync(ctx: SyncContext): Promise<SyncStats> {
  if (!ctx.accessToken) {
    throw new IntegrationAuthError("Exact Online connection has no access token");
  }
  const division = ctx.metadata.division as number | undefined;
  if (!division) {
    throw new IntegrationAuthError("Exact Online connection has no division; reconnect");
  }

  const [sales, purchases] = await Promise.all([
    exactGet<ExactEnvelope<ExactSalesInvoice>>(
      `/api/v1/${division}/salesinvoice/SalesInvoices?$select=InvoiceID,InvoiceNumber,InvoiceDate,DueDate,AmountDC,Currency,InvoiceToName&$top=100&$orderby=InvoiceDate desc`,
      ctx.accessToken
    ),
    exactGet<ExactEnvelope<ExactPurchaseEntry>>(
      `/api/v1/${division}/purchaseentry/PurchaseEntries?$select=EntryID,EntryNumber,EntryDate,DueDate,AmountDC,Currency,Description&$top=100&$orderby=EntryDate desc`,
      ctx.accessToken
    ),
  ]);

  const synced: SyncedInvoice[] = [
    ...sales.d.results.map(
      (invoice): SyncedInvoice => ({
        externalRef: `exact:sales:${invoice.InvoiceID}`,
        vendor: invoice.InvoiceToName ?? "Exact customer",
        invoiceNumber: invoice.InvoiceNumber ? String(invoice.InvoiceNumber) : null,
        invoiceDate: exactDate(invoice.InvoiceDate),
        dueDate: exactDate(invoice.DueDate),
        currency: invoice.Currency ?? ctx.currency,
        total: Math.abs(invoice.AmountDC ?? 0),
        direction: "RECEIVABLE",
        status: "UNPAID",
      })
    ),
    ...purchases.d.results.map(
      (entry): SyncedInvoice => ({
        externalRef: `exact:purchase:${entry.EntryID}`,
        vendor: entry.Description ?? "Exact supplier",
        invoiceNumber: entry.EntryNumber ? String(entry.EntryNumber) : null,
        invoiceDate: exactDate(entry.EntryDate),
        dueDate: exactDate(entry.DueDate),
        currency: entry.Currency ?? ctx.currency,
        total: Math.abs(entry.AmountDC ?? 0),
        direction: "PAYABLE",
        status: "UNPAID",
      })
    ),
  ];

  const result = await upsertSyncedInvoices(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    synced
  );
  return {
    sales: sales.d.results.length,
    purchases: purchases.d.results.length,
    created: result.created,
    updated: result.updated,
  };
}

export const exactHooks: ProviderHooks = { afterConnect, sync };
