import "server-only";

import { logger, serializeError } from "@/lib/logger";

import { importBankTransactions, type BankTransaction } from "../bank-import";
import {
  agreementFor,
  assessRequisition,
  computeDateFrom,
  consentState,
  isAccountRateLimited,
  mapBookedTransactions,
  pickBalance,
  rateLimitRetryAt,
  type GcBalance,
  type GcInstitution,
  type GcTransaction,
} from "../gocardless-core";
import { IntegrationAuthError, IntegrationError, appUrl } from "../oauth";

import type { ProviderHooks, SyncContext, SyncStats } from "./types";

/**
 * GoCardless Bank Account Data (ex-Nordigen). No per-user OAuth tokens:
 * API access tokens are minted from the secret id/key, and the user approves
 * a *requisition* (scoped by an end-user agreement) at their bank. We store
 * the requisition + account ids + consent expiry in connection metadata and
 * fetch a fresh API token on every sync.
 *
 * Endpoints per https://bankaccountdata.gocardless.com/api/v2 docs:
 *   POST /token/new/                          mint access token
 *   GET  /institutions/?country=XX            list banks
 *   GET  /institutions/{id}/                  bank capabilities
 *   POST /agreements/enduser/                 consent scope + duration
 *   POST /requisitions/                       start the link flow
 *   GET  /requisitions/{id}/                  status + linked accounts
 *   GET  /accounts/{id}/                      account metadata (iban, currency)
 *   GET  /accounts/{id}/transactions/         booked+pending, date_from/date_to
 *   GET  /accounts/{id}/balances/             Berlin Group balance list
 */

const BASE = "https://bankaccountdata.gocardless.com/api/v2";

export const SANDBOX_INSTITUTION_ID = "SANDBOXFINANCE_SFIN0000";

/** Thrown on 429s; carries the reset time from the rate-limit headers. */
export class GcRateLimitError extends IntegrationError {
  constructor(
    message: string,
    public readonly retryAt: Date
  ) {
    super(message);
  }
}

async function apiToken(): Promise<string> {
  const secretId = process.env.GOCARDLESS_SECRET_ID;
  const secretKey = process.env.GOCARDLESS_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new IntegrationError("GoCardless is not configured");
  }
  const response = await fetch(`${BASE}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }),
  });
  if (!response.ok) {
    throw new IntegrationError(`GoCardless token request failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { access: string };
  return body.access;
}

/** Error body shape documented under "Statuses and Error Code". */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { summary?: string; detail?: string };
    return body.detail || body.summary || "";
  } catch {
    return "";
  }
}

async function gcFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationAuthError(`GoCardless auth failed on ${path}`);
  }
  if (response.status === 429) {
    const retryAt = rateLimitRetryAt((name) => response.headers.get(name));
    throw new GcRateLimitError(
      `GoCardless rate limit reached on ${path}; retry after ${retryAt.toISOString()}`,
      retryAt
    );
  }
  if (response.status === 409) {
    // AccountProcessing: data not ready yet; the next sync will pick it up.
    throw new IntegrationError(
      "The bank is still preparing this account's data. Try again in a few minutes."
    );
  }
  if (!response.ok) {
    const detail = await errorDetail(response);
    throw new IntegrationError(
      `GoCardless ${path} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`
    );
  }
  return (await response.json()) as T;
}

// ------------------------------------------------------------- institutions

export interface InstitutionOption {
  id: string;
  name: string;
  logo: string | null;
  /** Days of transaction history the bank exposes. */
  historyDays: number | null;
}

/** Lists banks available in a country for the picker UI. */
export async function listInstitutions(country: string): Promise<InstitutionOption[]> {
  const token = await apiToken();
  const institutions = await gcFetch<GcInstitution[]>(
    `/institutions/?country=${encodeURIComponent(country.toLowerCase())}`,
    token
  );
  const options = institutions.map((institution) => ({
    id: institution.id,
    name: institution.name,
    logo: institution.logo ?? null,
    historyDays: Number(institution.transaction_total_days) || null,
  }));
  // Surface the sandbox bank in the picker when the server is set up for it.
  if (process.env.GOCARDLESS_INSTITUTION_ID?.startsWith("SANDBOX")) {
    options.push({
      id: SANDBOX_INSTITUTION_ID,
      name: "Sandbox Finance (test bank)",
      logo: null,
      historyDays: 90,
    });
  }
  return options;
}

// -------------------------------------------------------------- requisition

/**
 * Creates an end-user agreement sized to the institution's capabilities and
 * a requisition pointing at it; returns the bank-approval link.
 */
export async function createRequisition(
  institutionId: string,
  reference: string
): Promise<{ requisitionId: string; link: string }> {
  const token = await apiToken();

  let agreementId: string | null = null;
  if (institutionId !== SANDBOX_INSTITUTION_ID) {
    // Agreement sizing needs the institution's limits; fall back to the API
    // defaults (90/90 days) if either call fails rather than blocking connect.
    try {
      const institution = await gcFetch<GcInstitution>(
        `/institutions/${encodeURIComponent(institutionId)}/`,
        token
      );
      const sizing = agreementFor(institution);
      const agreement = await gcFetch<{ id: string }>("/agreements/enduser/", token, {
        method: "POST",
        body: JSON.stringify({
          institution_id: institutionId,
          max_historical_days: sizing.maxHistoricalDays,
          access_valid_for_days: sizing.accessValidForDays,
          // "details" is deliberately excluded: we never call /details/ and
          // each scope consumes its own per-day request budget at the bank.
          access_scope: ["balances", "transactions"],
        }),
      });
      agreementId = agreement.id;
    } catch (error) {
      if (error instanceof IntegrationAuthError) throw error;
      logger.warn("[integrations] gocardless agreement creation failed; using defaults", {
        error: serializeError(error),
      });
    }
  }

  const requisition = await gcFetch<{ id: string; link: string }>("/requisitions/", token, {
    method: "POST",
    body: JSON.stringify({
      redirect: `${appUrl()}/api/integrations/gocardless/callback`,
      institution_id: institutionId,
      reference,
      user_language: "EN",
      ...(agreementId ? { agreement: agreementId } : {}),
    }),
  });
  return { requisitionId: requisition.id, link: requisition.link };
}

export interface FinalizedRequisition {
  accounts: string[];
  institutionId: string;
  institutionName: string | null;
  /** Per-account IBAN tails for friendly labels ("…1234"). */
  accountLabels: string[];
  consentExpiresAt: string | null;
  maxHistoricalDays: number | null;
}

interface GcRequisition {
  id: string;
  status: string;
  accounts: string[];
  institution_id: string;
  agreement?: string;
}

interface GcAgreement {
  id: string;
  accepted: string | null;
  access_valid_for_days: number;
  max_historical_days: number;
}

/** Fetches the requisition after the redirect and assembles the metadata. */
export async function finalizeRequisition(requisitionId: string): Promise<FinalizedRequisition> {
  const token = await apiToken();
  const requisition = await gcFetch<GcRequisition>(`/requisitions/${requisitionId}/`, token);

  const assessment = assessRequisition(requisition.status, requisition.accounts.length);
  if (!assessment.ok) {
    throw new IntegrationError(assessment.message);
  }

  // Everything below is enrichment: failures must not lose the connection.
  let consentExpiresAt: string | null = null;
  let maxHistoricalDays: number | null = null;
  if (requisition.agreement) {
    try {
      const agreement = await gcFetch<GcAgreement>(
        `/agreements/enduser/${requisition.agreement}/`,
        token
      );
      const anchor = agreement.accepted ? Date.parse(agreement.accepted) : Date.now();
      consentExpiresAt = new Date(
        anchor + agreement.access_valid_for_days * 24 * 60 * 60 * 1000
      ).toISOString();
      maxHistoricalDays = agreement.max_historical_days;
    } catch (error) {
      logger.warn("[integrations] gocardless agreement lookup failed", {
        error: serializeError(error),
      });
    }
  }

  let institutionName: string | null = null;
  try {
    const institution = await gcFetch<GcInstitution>(
      `/institutions/${encodeURIComponent(requisition.institution_id)}/`,
      token
    );
    institutionName = institution.name;
  } catch {
    institutionName = null;
  }

  const accountLabels: string[] = [];
  for (const accountId of requisition.accounts) {
    try {
      const account = await gcFetch<{ iban?: string }>(`/accounts/${accountId}/`, token);
      accountLabels.push(account.iban ? `…${account.iban.slice(-4)}` : "account");
    } catch {
      accountLabels.push("account");
    }
  }

  return {
    accounts: requisition.accounts,
    institutionId: requisition.institution_id,
    institutionName,
    accountLabels,
    consentExpiresAt,
    maxHistoricalDays,
  };
}

// --------------------------------------------------------------------- sync

interface GcMetadata {
  accounts?: string[];
  consentExpiresAt?: string;
  maxHistoricalDays?: number;
  lastSyncedAt?: string;
  rateLimitedUntil?: Record<string, string>;
  balances?: Record<string, { amount: number; currency: string; type: string; at: string }>;
}

async function sync(ctx: SyncContext): Promise<SyncStats> {
  const metadata = ctx.metadata as GcMetadata;
  const accounts = metadata.accounts ?? [];
  if (accounts.length === 0) {
    throw new IntegrationAuthError("No linked bank accounts; reconnect required");
  }

  // Consent lifecycle: an expired end-user agreement means every account
  // call would 401/403 — surface the reconnect need directly instead.
  const consent = consentState(metadata.consentExpiresAt ?? null);
  if (consent.state === "expired") {
    throw new IntegrationAuthError(
      "Bank consent has expired — reconnect to renew access. Your imported transactions are unaffected."
    );
  }

  const token = await apiToken();
  const now = new Date();
  const dateFrom = computeDateFrom(
    metadata.lastSyncedAt ?? null,
    metadata.maxHistoricalDays ?? null,
    now
  );

  const transactions: BankTransaction[] = [];
  const rateLimitedUntil: Record<string, string> = { ...(metadata.rateLimitedUntil ?? {}) };
  const balances = { ...(metadata.balances ?? {}) };
  let fetched = 0;
  let accountsSynced = 0;
  let accountsSkipped = 0;

  for (const accountId of accounts) {
    // Respect the bank's per-account daily budget recorded on earlier 429s.
    if (isAccountRateLimited(rateLimitedUntil, accountId, now)) {
      accountsSkipped += 1;
      continue;
    }

    try {
      const body = await gcFetch<{ transactions: { booked: GcTransaction[] } }>(
        `/accounts/${accountId}/transactions/?date_from=${dateFrom}`,
        token
      );
      delete rateLimitedUntil[accountId];
      const mapped = mapBookedTransactions(accountId, body.transactions.booked ?? []);
      fetched += mapped.length;
      transactions.push(...mapped);
      accountsSynced += 1;
    } catch (error) {
      if (error instanceof GcRateLimitError) {
        rateLimitedUntil[accountId] = error.retryAt.toISOString();
        accountsSkipped += 1;
        continue;
      }
      throw error;
    }

    // Balance snapshot for the UI; each scope has its own budget, so a
    // balance 429 must never fail the transaction sync.
    try {
      const body = await gcFetch<{ balances: GcBalance[] }>(
        `/accounts/${accountId}/balances/`,
        token
      );
      const picked = pickBalance(body.balances ?? []);
      if (picked) {
        balances[accountId] = { ...picked, at: now.toISOString() };
      }
    } catch (error) {
      if (!(error instanceof GcRateLimitError)) {
        logger.warn("[integrations] gocardless balance fetch failed", {
          error: serializeError(error),
        });
      }
    }
  }

  const result = await importBankTransactions(
    ctx.userId,
    ctx.currency,
    "gocardless",
    `GoCardless sync ${now.toISOString().slice(0, 10)}`,
    transactions
  );

  await ctx.patchMetadata({
    // Only advance the incremental cursor when at least one account synced;
    // otherwise a fully rate-limited pass would silently skip a window.
    ...(accountsSynced > 0 ? { lastSyncedAt: now.toISOString() } : {}),
    rateLimitedUntil,
    balances,
    ...(result.batchId ? { lastBatchId: result.batchId } : {}),
  });

  return {
    fetched,
    imported: result.imported,
    duplicates: result.duplicates,
    accountsSynced,
    accountsSkipped,
  };
}

export const gocardlessHooks: ProviderHooks = { sync };
