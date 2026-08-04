import "server-only";

import { upsertSyncedInvoices, type SyncedInvoice } from "../invoice-sync";
import { IntegrationAuthError, IntegrationError, type TokenSet } from "../oauth";

import type { ProviderHooks, SyncContext, SyncStats } from "./types";

/**
 * Xero: OAuth2 with tenant discovery (GET /connections after the exchange),
 * invoices from the Accounting API. ACCPAY = bills you owe (payable),
 * ACCREC = invoices you issued (receivable).
 */

interface XeroInvoice {
  InvoiceID: string;
  Type: "ACCPAY" | "ACCREC";
  InvoiceNumber?: string;
  Contact?: { Name?: string };
  DateString?: string;
  DueDateString?: string;
  Date?: string;
  DueDate?: string;
  Status: string;
  Total?: number;
  AmountDue?: number;
  CurrencyCode?: string;
}

function xeroDate(iso: string | undefined, msDate: string | undefined): string | null {
  if (iso) return iso.slice(0, 10);
  const match = msDate ? /\/Date\((\d+)/.exec(msDate) : null;
  if (!match) return null;
  return new Date(Number(match[1])).toISOString().slice(0, 10);
}

async function afterConnect({ tokens }: { userId: string; tokens: TokenSet }) {
  const response = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (!response.ok) {
    throw new IntegrationError(`Xero tenant lookup failed: HTTP ${response.status}`);
  }
  const connections = (await response.json()) as {
    tenantId: string;
    tenantName?: string;
  }[];
  const tenant = connections[0];
  if (!tenant) {
    throw new IntegrationError("No Xero organisation was authorised");
  }
  return {
    externalId: tenant.tenantId,
    institutionName: tenant.tenantName ?? null,
    metadata: { tenantId: tenant.tenantId, tenantName: tenant.tenantName ?? null },
  };
}

async function sync(ctx: SyncContext): Promise<SyncStats> {
  if (!ctx.accessToken) {
    throw new IntegrationAuthError("Xero connection has no access token");
  }
  const tenantId = ctx.metadata.tenantId as string | undefined;
  if (!tenantId) {
    throw new IntegrationAuthError("Xero connection has no tenant; reconnect required");
  }

  const url = new URL("https://api.xero.com/api.xro/2.0/Invoices");
  url.searchParams.set("page", "1");
  url.searchParams.set(
    "where",
    'Status=="AUTHORISED" OR Status=="PAID" OR Status=="SUBMITTED"'
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      "xero-tenant-id": tenantId,
      Accept: "application/json",
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationAuthError("Xero token rejected; reconnect required");
  }
  if (!response.ok) {
    throw new IntegrationError(`Xero invoices request failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { Invoices?: XeroInvoice[] };
  const invoices = body.Invoices ?? [];

  const synced: SyncedInvoice[] = invoices.map((invoice) => ({
    externalRef: `xero:${invoice.InvoiceID}`,
    vendor: invoice.Contact?.Name ?? "Xero contact",
    invoiceNumber: invoice.InvoiceNumber ?? null,
    invoiceDate: xeroDate(invoice.DateString, invoice.Date),
    dueDate: xeroDate(invoice.DueDateString, invoice.DueDate),
    currency: invoice.CurrencyCode ?? ctx.currency,
    total: invoice.Total ?? 0,
    direction: invoice.Type === "ACCREC" ? "RECEIVABLE" : "PAYABLE",
    status: invoice.Status === "PAID" || (invoice.AmountDue ?? 1) === 0 ? "PAID" : "UNPAID",
  }));

  const result = await upsertSyncedInvoices(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    synced
  );
  return { fetched: invoices.length, created: result.created, updated: result.updated };
}

export const xeroHooks: ProviderHooks = { afterConnect, sync };
