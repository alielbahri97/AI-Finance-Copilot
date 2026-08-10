import "server-only";

import { logger, serializeError } from "@/lib/logger";

import { recordBankAccounts, type BankAccountSnapshot } from "../bank-accounts";
import { importBankTransactions, type BankTransaction } from "../bank-import";
import {
  accountBudgetRemaining,
  agreementConsentExpiry,
  agreementFor,
  assessRequisition,
  classifyAccountError,
  computeDateFrom,
  consentState,
  isAccountRateLimited,
  mapBookedTransactions,
  pickBalance,
  rateLimitRetryAt,
  requisitionStatusCode,
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
 * share one process-wide API token across every connection.
 *
 * Endpoints per https://bankaccountdata.gocardless.com/api/v2 docs:
 *   POST /token/new/                          mint the JWT pair
 *   POST /token/refresh/                      new access token from the refresh
 *   GET  /institutions/?country=XX            list banks
 *   GET  /institutions/{id}/                  bank capabilities
 *   POST /agreements/enduser/                 consent scope + duration
 *   GET  /agreements/enduser/{id}/            acceptance date + agreed window
 *   POST /requisitions/                       start the link flow
 *   GET  /requisitions/{id}/                  status + linked accounts
 *   GET  /accounts/{id}/                      account metadata (iban, status)
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

/**
 * Thrown when one account cannot be read although the connection itself is
 * healthy: AccountProcessing, a per-account permission gap, or a transient
 * institution error. The sync skips that account and keeps the others.
 */
export class GcAccountUnavailableError extends IntegrationError {}

interface GcToken {
  access: string;
  access_expires?: number;
  refresh?: string;
  refresh_expires?: number;
}

/**
 * The API credentials belong to this server, not to a workspace, so one token
 * serves every connection. POST /token/new/ is capped at 100 per *hour* for
 * the whole company — minting one per sync would exhaust it — so the token is
 * held process-wide and renewed through /token/refresh/ (100/min) until the
 * refresh token itself lapses.
 */
let cachedToken: {
  access: string;
  accessExpiresAt: number;
  refresh: string | null;
  refreshExpiresAt: number;
} | null = null;

/** In-flight mint, so parallel syncs on a cold process share one request. */
let pendingToken: Promise<string> | null = null;

/** Renew this far ahead of expiry so a running sync never uses a dead token. */
const TOKEN_MARGIN_MS = 60 * 1000;

/** Documented access-token lifetime, for responses that omit it. */
const ACCESS_TTL_SECONDS = 24 * 60 * 60;

function expiresAt(now: number, seconds: number | undefined, fallbackSeconds: number): number {
  const valid = typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0;
  return now + (valid ? seconds : fallbackSeconds) * 1000;
}

async function tokenRequest(path: string, body: Record<string, string>): Promise<GcToken> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 429) {
    const retryAt = rateLimitRetryAt((name) => response.headers.get(name));
    throw new GcRateLimitError(
      `GoCardless rate limit reached on ${path}; retry after ${retryAt.toISOString()}`,
      retryAt
    );
  }
  if (!response.ok) {
    const { summary, detail } = await errorBody(response);
    // Both failure modes here are server setup mistakes rather than anything
    // the end user did, so they are named instead of shown as a bare status.
    const hint =
      response.status === 401
        ? " — check GOCARDLESS_SECRET_ID and GOCARDLESS_SECRET_KEY"
        : response.status === 403
          ? " — this server's IP address is not in the user secret's allow-list"
          : "";
    throw new IntegrationError(
      `GoCardless ${path} failed: HTTP ${response.status}${hint}${describe(summary, detail)}`
    );
  }
  return (await response.json()) as GcToken;
}

async function mintToken(secretId: string, secretKey: string): Promise<string> {
  const now = Date.now();
  if (cachedToken?.refresh && cachedToken.refreshExpiresAt - TOKEN_MARGIN_MS > now) {
    try {
      const refreshed = await tokenRequest("/token/refresh/", { refresh: cachedToken.refresh });
      cachedToken = {
        ...cachedToken,
        access: refreshed.access,
        accessExpiresAt: expiresAt(now, refreshed.access_expires, ACCESS_TTL_SECONDS),
      };
      return cachedToken.access;
    } catch (error) {
      logger.warn("[integrations] gocardless token refresh failed; minting a new one", {
        error: serializeError(error),
      });
    }
  }
  const minted = await tokenRequest("/token/new/", {
    secret_id: secretId,
    secret_key: secretKey,
  });
  cachedToken = {
    access: minted.access,
    accessExpiresAt: expiresAt(now, minted.access_expires, ACCESS_TTL_SECONDS),
    refresh: minted.refresh ?? null,
    // No stated refresh window means treat it as unusable and mint next time.
    refreshExpiresAt: expiresAt(now, minted.refresh_expires, 0),
  };
  return cachedToken.access;
}

async function apiToken(): Promise<string> {
  const secretId = process.env.GOCARDLESS_SECRET_ID;
  const secretKey = process.env.GOCARDLESS_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new IntegrationError("GoCardless is not configured");
  }
  if (cachedToken && cachedToken.accessExpiresAt - TOKEN_MARGIN_MS > Date.now()) {
    return cachedToken.access;
  }
  pendingToken ??= mintToken(secretId, secretKey).finally(() => {
    pendingToken = null;
  });
  return pendingToken;
}

/** Error body shape documented under "Statuses and Error Code". */
async function errorBody(response: Response): Promise<{ summary: string; detail: string }> {
  try {
    const body = (await response.json()) as { summary?: string; detail?: string };
    return { summary: body.summary ?? "", detail: body.detail ?? "" };
  } catch {
    return { summary: "", detail: "" };
  }
}

function describe(summary: string, detail: string): string {
  const text = [summary, detail].filter(Boolean).join(" — ");
  return text ? ` — ${text}` : "";
}

/** Only /accounts/... carries the documented per-account error semantics. */
function isAccountPath(path: string): boolean {
  return path.startsWith("/accounts/");
}

/** Response body plus a header reader, for the rate-limit budget headers. */
interface GcResponse<T> {
  data: T;
  getHeader: (name: string) => string | null;
}

async function gcRequest<T>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<GcResponse<T>> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (response.ok) {
    return {
      data: (await response.json()) as T,
      getHeader: (name) => response.headers.get(name),
    };
  }

  const { summary, detail } = await errorBody(response);
  const kind = isAccountPath(path)
    ? classifyAccountError(response.status, summary)
    : response.status === 429
      ? "rate_limit"
      : response.status === 401 || response.status === 403
        ? "auth"
        : "error";

  if (kind === "rate_limit") {
    const retryAt = rateLimitRetryAt((name) => response.headers.get(name));
    throw new GcRateLimitError(
      `GoCardless rate limit reached on ${path}; retry after ${retryAt.toISOString()}`,
      retryAt
    );
  }
  if (kind === "auth") {
    // The shared token may simply have been revoked early; drop it so the
    // next call mints a fresh one rather than expiring every connection.
    cachedToken = null;
    throw new IntegrationAuthError(`GoCardless auth failed on ${path}${describe(summary, detail)}`);
  }
  if (kind === "unavailable") {
    throw new GcAccountUnavailableError(
      /processing/i.test(`${summary} ${detail}`)
        ? "The bank is still preparing this account's data — the next sync will pick it up."
        : `The bank could not provide this account's data${describe(summary, detail)}`
    );
  }
  throw new IntegrationError(
    `GoCardless ${path} failed: HTTP ${response.status}${describe(summary, detail)}`
  );
}

async function gcFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  return (await gcRequest<T>(path, token, init)).data;
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
  // The sandbox bank is not part of any country's list, so it is added here
  // when the server is set up for it — first, because someone who configured
  // it is trying to test and should not hunt for it below forty real banks.
  if (process.env.GOCARDLESS_INSTITUTION_ID?.startsWith("SANDBOX")) {
    options.unshift({
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

  // Agreement sizing needs the institution's limits; fall back to the API
  // defaults (90/90 days) if either call fails rather than blocking connect.
  // The sandbox institution takes agreements like any other bank (docs:
  // Sandbox), so it goes down the same path and gets a real consent expiry —
  // which is what makes the consent lifecycle testable without a real bank.
  let agreementId: string | null = null;
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

export interface FinalizedAccount {
  id: string;
  /** IBAN/BBAN tail for a friendly label ("…1234"); null when the bank omits it. */
  mask: string | null;
  name: string | null;
}

export interface FinalizedRequisition {
  accounts: string[];
  institutionId: string;
  institutionName: string | null;
  institutionLogo: string | null;
  /** Per-account detail, in the same order as `accounts`. */
  accountDetails: FinalizedAccount[];
  consentExpiresAt: string | null;
  maxHistoricalDays: number | null;
}

interface GcRequisition {
  id: string;
  /** Documented as a string ("LN"); normalized because the reference types it
   *  as an object. */
  status: unknown;
  accounts?: string[];
  institution_id: string;
  /**
   * The end-user agreement this requisition was created with. The endpoint
   * reference names the field `agreement` while the quickstart's own sample
   * response returns `agreements`; both are read because this id is what
   * carries the consent expiry and the agreed history window, and losing it
   * silently downgrades the first sync to the 90-day default and removes the
   * renewal warning.
   */
  agreement?: string;
  agreements?: string;
}

interface GcAgreement {
  id: string;
  accepted: string | null;
  access_valid_for_days: number;
  max_historical_days: number;
}

/** Documented fields of GET /accounts/{id}/ — note the snake_case. */
interface GcAccountMetadata {
  iban?: string;
  bban?: string;
  status?: string;
  name?: string;
  owner_name?: string;
}

function maskOf(identifier: string | undefined): string | null {
  return identifier ? `…${identifier.slice(-4)}` : null;
}

/** Fetches the requisition after the redirect and assembles the metadata. */
export async function finalizeRequisition(requisitionId: string): Promise<FinalizedRequisition> {
  const token = await apiToken();
  const requisition = await gcFetch<GcRequisition>(
    `/requisitions/${encodeURIComponent(requisitionId)}/`,
    token
  );

  const accounts = requisition.accounts ?? [];
  const assessment = assessRequisition(requisitionStatusCode(requisition.status), accounts.length);
  if (!assessment.ok) {
    throw new IntegrationError(assessment.message);
  }

  // Everything below is enrichment: failures must not lose the connection.
  let consentExpiresAt: string | null = null;
  let maxHistoricalDays: number | null = null;
  const agreementId = requisition.agreement ?? requisition.agreements ?? null;
  if (agreementId) {
    try {
      const agreement = await gcFetch<GcAgreement>(
        `/agreements/enduser/${encodeURIComponent(agreementId)}/`,
        token
      );
      consentExpiresAt = agreementConsentExpiry(
        agreement.accepted,
        agreement.access_valid_for_days
      );
      maxHistoricalDays = Number(agreement.max_historical_days) || null;
    } catch (error) {
      logger.warn("[integrations] gocardless agreement lookup failed", {
        error: serializeError(error),
      });
    }
  }

  let institutionName: string | null = null;
  let institutionLogo: string | null = null;
  try {
    const institution = await gcFetch<GcInstitution>(
      `/institutions/${encodeURIComponent(requisition.institution_id)}/`,
      token
    );
    institutionName = institution.name;
    institutionLogo = institution.logo ?? null;
  } catch {
    institutionName = null;
  }

  // Account metadata is GoCardless's own record, so it costs none of the
  // per-scope daily budget that /transactions/ and /balances/ draw on. It
  // carries no currency — that arrives with the first balance snapshot — so
  // the field is left untouched here rather than being overwritten with null.
  const accountDetails: FinalizedAccount[] = [];
  for (const accountId of accounts) {
    try {
      const account = await gcFetch<GcAccountMetadata>(
        `/accounts/${encodeURIComponent(accountId)}/`,
        token
      );
      accountDetails.push({
        id: accountId,
        mask: maskOf(account.iban ?? account.bban),
        name: account.name ?? account.owner_name ?? null,
      });
    } catch {
      accountDetails.push({ id: accountId, mask: null, name: null });
    }
  }

  return {
    accounts,
    institutionId: requisition.institution_id,
    institutionName,
    institutionLogo,
    accountDetails,
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
  const snapshots: BankAccountSnapshot[] = [];
  /** Reasons accounts were skipped for something other than a rate limit. */
  const unavailable: string[] = [];
  let fetched = 0;
  let accountsSynced = 0;
  let accountsSkipped = 0;

  for (const accountId of accounts) {
    // Respect the bank's per-account daily budget recorded on earlier 429s.
    if (isAccountRateLimited(rateLimitedUntil, accountId, now)) {
      accountsSkipped += 1;
      continue;
    }

    // Set when a successful response reports the account's daily budget spent.
    let exhaustedUntil: Date | null = null;

    try {
      const { data, getHeader } = await gcRequest<{ transactions?: { booked?: GcTransaction[] } }>(
        `/accounts/${encodeURIComponent(accountId)}/transactions/?date_from=${dateFrom}`,
        token
      );
      delete rateLimitedUntil[accountId];
      const mapped = mapBookedTransactions(accountId, data.transactions?.booked ?? []);
      fetched += mapped.length;
      transactions.push(...mapped);
      accountsSynced += 1;
      if (accountBudgetRemaining(getHeader) === 0) {
        exhaustedUntil = rateLimitRetryAt(getHeader, now);
      }
    } catch (error) {
      if (error instanceof GcRateLimitError) {
        rateLimitedUntil[accountId] = error.retryAt.toISOString();
        accountsSkipped += 1;
        continue;
      }
      // One account still processing, lacking permission, or behind a bank
      // outage must not discard the accounts that did answer.
      if (error instanceof GcAccountUnavailableError) {
        unavailable.push(error.message);
        accountsSkipped += 1;
        continue;
      }
      throw error;
    }

    // Balance snapshot for the UI; each scope has its own budget, so a
    // balance 429 must never fail the transaction sync.
    try {
      const { data, getHeader } = await gcRequest<{ balances?: GcBalance[] }>(
        `/accounts/${encodeURIComponent(accountId)}/balances/`,
        token
      );
      const picked = pickBalance(data.balances ?? []);
      if (picked) {
        snapshots.push({
          externalAccountId: accountId,
          currency: picked.currency,
          balance: picked.amount,
          balanceAt: now,
          balanceType: picked.type,
        });
      }
      if (accountBudgetRemaining(getHeader) === 0) {
        exhaustedUntil ??= rateLimitRetryAt(getHeader, now);
      }
    } catch (error) {
      // Balances have their own daily budget, so exhausting it — or a bank that
      // simply won't serve them — is expected and not worth an error log.
      if (!(error instanceof GcRateLimitError) && !(error instanceof GcAccountUnavailableError)) {
        logger.warn("[integrations] gocardless balance fetch failed", {
          error: serializeError(error),
        });
      }
    }

    // The bank granted the last call it owed us today. Record the window now
    // so the next pass skips this account instead of spending a 429, which
    // would count against the shared per-minute limit for nothing.
    if (exhaustedUntil) {
      rateLimitedUntil[accountId] = exhaustedUntil.toISOString();
    }
  }

  // Nothing readable for a reason the user can act on is a failed sync, not a
  // quiet success: otherwise the card would report "synced" while importing
  // nothing indefinitely. A pure rate-limit pass is different — it resolves on
  // its own and the UI already explains the wait.
  if (accountsSynced === 0 && unavailable.length > 0) {
    await ctx.patchMetadata({ rateLimitedUntil });
    throw new IntegrationError(unavailable[0]);
  }

  const result = await importBankTransactions(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    ctx.currency,
    "gocardless",
    `GoCardless sync ${now.toISOString().slice(0, 10)}`,
    transactions,
    { aiProvider: ctx.aiProvider }
  );

  // Balance snapshots land on the account rows, which is what the aggregated
  // cash view reads. A snapshot failure must not fail an otherwise good sync.
  await recordBankAccounts(ctx.connection.id, snapshots).catch((error) =>
    logger.warn("[integrations] gocardless balance snapshot", { error: serializeError(error) })
  );

  await ctx.patchMetadata({
    // Only advance the incremental cursor when at least one account synced;
    // otherwise a fully rate-limited pass would silently skip a window.
    ...(accountsSynced > 0 ? { lastSyncedAt: now.toISOString() } : {}),
    rateLimitedUntil,
    ...(result.batchId ? { lastBatchId: result.batchId } : {}),
  });

  return {
    fetched,
    imported: result.imported,
    duplicates: result.duplicates,
    aiCategorized: result.aiCategorized,
    accountsSynced,
    accountsSkipped,
  };
}

export const gocardlessHooks: ProviderHooks = { sync };
