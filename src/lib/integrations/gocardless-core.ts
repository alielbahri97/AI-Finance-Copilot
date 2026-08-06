import { createHash } from "node:crypto";

/**
 * Pure GoCardless Bank Account Data logic: response parsing, transaction
 * mapping, rate-limit decisions and consent lifecycle math. Kept free of
 * server-only imports so it is unit-testable; the provider module in
 * providers/gocardless.ts does the actual HTTP + persistence work.
 *
 * Shapes follow the documented Berlin Group PSD2 format returned by
 * https://bankaccountdata.gocardless.com/api/v2.
 */

// ---------------------------------------------------------------- API shapes

export interface GcAmount {
  /** Decimal string, e.g. "-15.00". */
  amount: string;
  currency: string;
}

export interface GcTransaction {
  transactionId?: string;
  internalTransactionId?: string;
  entryReference?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: GcAmount;
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  creditorName?: string;
  debtorName?: string;
}

export interface GcBalance {
  balanceAmount: GcAmount;
  balanceType: string;
  referenceDate?: string;
}

export interface GcInstitution {
  id: string;
  name: string;
  bic?: string;
  logo?: string;
  countries?: string[];
  /** How many days of history the bank exposes, as a decimal string. */
  transaction_total_days?: string;
  /** Longest consent the bank supports, as a decimal string. */
  max_access_valid_for_days?: string;
}

// -------------------------------------------------------- requisition states

/** Documented requisition statuses (docs: Statuses and Error Code). */
export type RequisitionStatus = "CR" | "GC" | "UA" | "RJ" | "SA" | "GA" | "LN" | "EX";

/**
 * The two-letter status code out of a requisition payload.
 *
 * The API returns `status` as a plain string ("LN"), but the endpoint reference
 * types it as an object and the older Nordigen shape was
 * `{ short, long, description }`. Normalizing both here means a shape change
 * cannot silently turn a linked requisition into an "unknown" failure.
 */
export function requisitionStatusCode(status: unknown): string {
  if (typeof status === "string") return status;
  if (status && typeof status === "object") {
    const record = status as { short?: unknown; long?: unknown };
    if (typeof record.short === "string") return record.short;
    if (typeof record.long === "string") return LONG_TO_SHORT_STATUS[record.long] ?? record.long;
  }
  return "";
}

const LONG_TO_SHORT_STATUS: Record<string, string> = {
  CREATED: "CR",
  GIVING_CONSENT: "GC",
  UNDERGOING_AUTHENTICATION: "UA",
  REJECTED: "RJ",
  SELECTING_ACCOUNTS: "SA",
  GRANTING_ACCESS: "GA",
  LINKED: "LN",
  EXPIRED: "EX",
};

export interface RequisitionAssessment {
  ok: boolean;
  /** "in_progress" | "rejected" | "expired" — drives the friendly message. */
  kind: "linked" | "in_progress" | "rejected" | "expired" | "unknown";
  message: string;
}

/** Maps a requisition status to a user-facing outcome after the redirect. */
export function assessRequisition(status: string, accountCount: number): RequisitionAssessment {
  if (status === "LN") {
    if (accountCount === 0) {
      return {
        ok: false,
        kind: "unknown",
        message:
          "Your bank approved the connection but returned no accounts. Try again, and pick at least one account at the bank.",
      };
    }
    return { ok: true, kind: "linked", message: "Linked" };
  }
  if (status === "RJ") {
    return {
      ok: false,
      kind: "rejected",
      message:
        "The bank rejected the connection — this usually means the login was cancelled or the credentials were not accepted. No access was granted; you can safely try again.",
    };
  }
  if (status === "EX") {
    return {
      ok: false,
      kind: "expired",
      message: "The connection request expired before it was approved. Start again when you're ready.",
    };
  }
  if (["CR", "GC", "UA", "SA", "GA"].includes(status)) {
    return {
      ok: false,
      kind: "in_progress",
      message:
        "The bank connection was not finished — it looks like the approval was left part-way. Connect again and complete all steps at your bank.",
    };
  }
  return {
    ok: false,
    kind: "unknown",
    message: "The bank connection could not be completed. Try connecting again.",
  };
}

// --------------------------------------------------------- transaction shape

/** Structurally identical to bank-import's BankTransaction. */
export interface MappedTransaction {
  externalId: string;
  date: string;
  description: string;
  counterparty: string | null;
  amount: number;
  type: "INCOME" | "EXPENSE";
}

function remittance(tx: GcTransaction): string {
  return (
    tx.remittanceInformationUnstructured ||
    tx.remittanceInformationUnstructuredArray?.filter(Boolean).join(" ") ||
    ""
  );
}

function externalIdOf(accountId: string, tx: GcTransaction): string {
  const explicit = tx.transactionId ?? tx.internalTransactionId ?? tx.entryReference;
  if (explicit) return `${accountId}:${explicit}`;
  // Some banks omit ids entirely; derive a stable fingerprint instead.
  const digest = createHash("sha256")
    .update(
      [accountId, tx.bookingDate ?? "", tx.transactionAmount.amount, remittance(tx)].join("|")
    )
    .digest("hex");
  return `${accountId}:${digest}`;
}

/**
 * Maps booked PSD2 transactions to the shared bank-import shape. Skips
 * zero/invalid amounts and entries with no usable date. Amounts are signed
 * from the bank's perspective: negative = money out.
 */
export function mapBookedTransactions(
  accountId: string,
  booked: GcTransaction[]
): MappedTransaction[] {
  const mapped: MappedTransaction[] = [];
  for (const tx of booked) {
    const amount = Number(tx.transactionAmount?.amount);
    const date = tx.bookingDate ?? tx.valueDate;
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    mapped.push({
      externalId: externalIdOf(accountId, tx),
      date,
      description: remittance(tx) || tx.creditorName || tx.debtorName || "Bank transaction",
      counterparty: (amount < 0 ? tx.creditorName : tx.debtorName) ?? null,
      amount: Math.abs(amount),
      type: amount < 0 ? "EXPENSE" : "INCOME",
    });
  }
  return mapped;
}

// ------------------------------------------------------------------ balances

/**
 * Preference order per the Berlin Group balance types: the available balance
 * is what users think of as "my balance"; expected projects end-of-day;
 * the booked variants trail it.
 */
const BALANCE_TYPE_PREFERENCE = [
  "interimAvailable",
  "expected",
  "interimBooked",
  "closingBooked",
  "closingAvailable",
  "openingBooked",
  "information",
];

export interface PickedBalance {
  amount: number;
  currency: string;
  type: string;
}

/** Picks the most decision-useful balance from a /balances/ response. */
export function pickBalance(balances: GcBalance[]): PickedBalance | null {
  const usable = balances.filter((balance) => {
    const amount = Number(balance.balanceAmount?.amount);
    return Number.isFinite(amount) && Boolean(balance.balanceType);
  });
  if (usable.length === 0) return null;

  usable.sort((a, b) => {
    const rankA = BALANCE_TYPE_PREFERENCE.indexOf(a.balanceType);
    const rankB = BALANCE_TYPE_PREFERENCE.indexOf(b.balanceType);
    return (rankA === -1 ? 99 : rankA) - (rankB === -1 ? 99 : rankB);
  });

  const best = usable[0];
  return {
    amount: Number(best.balanceAmount.amount),
    currency: best.balanceAmount.currency,
    type: best.balanceType,
  };
}

// ------------------------------------------------------- error classification

/**
 * What an error from an account-scoped endpoint (/transactions/, /balances/)
 * means for the caller:
 *   - "auth":        access is gone; the user must reconnect
 *   - "rate_limit":  the bank's daily budget is spent; retry after the reset
 *   - "unavailable": this account cannot be read *right now*, but the others
 *                    can and the connection is fine
 *   - "error":       anything else, treated as a real failure
 *
 * Mapped from the documented messages (docs: Statuses and Error Code):
 *   401 EUA expired / AccessExpiredError / AccountInactiveError / Invalid token
 *   403 AccountAccessForbidden / AccountResourceUnavailable
 *   409 Account Suspended (reconnect) | AccountProcessing (not ready yet)
 *   429 RateLimitError
 *   500 UnknownRequestError · 503 ServiceError / ConnectionError
 */
export type GcErrorKind = "auth" | "rate_limit" | "unavailable" | "error";

export function classifyAccountError(status: number, summary?: string): GcErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 401) return "auth";
  if (status === 409) {
    // Suspension follows ten consecutive failures and only a reconnect clears
    // it; AccountProcessing resolves on its own within minutes.
    return /suspend/i.test(summary ?? "") ? "auth" : "unavailable";
  }
  // A per-account permission gap (the user did not grant transactions on this
  // account) must not condemn the whole connection.
  if (status === 403) return "unavailable";
  if (status >= 500) return "unavailable";
  return "error";
}

// ---------------------------------------------------------------- rate limit

/**
 * GoCardless enforces strict per-account, per-scope daily limits (as low as
 * 4 calls/day per the bank). 429 responses carry reset headers in seconds:
 * account-scope limits in x-ratelimit-account-success-reset, general limits
 * in x-ratelimit-reset.
 */
export function rateLimitRetryAt(
  getHeader: (name: string) => string | null,
  now: Date = new Date()
): Date {
  const raw =
    getHeader("x-ratelimit-account-success-reset") ?? getHeader("x-ratelimit-reset");
  const seconds = raw ? Number(raw) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(now.getTime() + seconds * 1000);
  }
  // Daily-limit worst case: try again in 24h.
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/** Per-account skip decision from the stored `rateLimitedUntil` metadata map. */
export function isAccountRateLimited(
  rateLimitedUntil: Record<string, string> | undefined,
  accountId: string,
  now: Date = new Date()
): boolean {
  const until = rateLimitedUntil?.[accountId];
  if (!until) return false;
  const parsed = Date.parse(until);
  return Number.isFinite(parsed) && parsed > now.getTime();
}

// ------------------------------------------------------------ sync date math

/** Overlap window so late-booked transactions are still caught (deduped by hash). */
const SYNC_OVERLAP_DAYS = 5;
const DEFAULT_HISTORICAL_DAYS = 90;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * date_from for the transactions endpoint: full agreed history on the first
 * sync, then a small overlap window before the last successful sync. Keeps
 * responses small — important with 4-requests/day banks.
 */
export function computeDateFrom(
  lastSyncedAt: string | null | undefined,
  maxHistoricalDays: number | null | undefined,
  now: Date = new Date()
): string {
  const lastSynced = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
  if (Number.isFinite(lastSynced)) {
    return isoDay(new Date(lastSynced - SYNC_OVERLAP_DAYS * 24 * 60 * 60 * 1000));
  }
  const days =
    maxHistoricalDays && maxHistoricalDays > 0 ? maxHistoricalDays : DEFAULT_HISTORICAL_DAYS;
  return isoDay(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}

// ------------------------------------------------------------------- consent

export interface ConsentState {
  state: "unknown" | "active" | "expiring" | "expired";
  daysLeft: number | null;
}

/** Warn this many days before the end-user agreement lapses. */
export const CONSENT_WARNING_DAYS = 14;

/**
 * Absolute consent expiry from an end-user agreement: `access_valid_for_days`
 * counted from `accepted`.
 *
 * `accepted` is `""` until the user approves at the bank, and returns null for
 * any value that will not parse — building an Invalid Date here used to throw
 * out of the enrichment block and take `maxHistoricalDays` down with it, so the
 * first sync silently fell back to the 90-day default.
 */
export function agreementConsentExpiry(
  accepted: string | null | undefined,
  accessValidForDays: number | null | undefined,
  now: Date = new Date()
): string | null {
  if (!Number.isFinite(accessValidForDays) || (accessValidForDays ?? 0) <= 0) return null;
  const anchor = accepted ? Date.parse(accepted) : now.getTime();
  if (!Number.isFinite(anchor)) return null;
  return new Date(anchor + (accessValidForDays as number) * 24 * 60 * 60 * 1000).toISOString();
}

export function consentState(
  consentExpiresAt: string | null | undefined,
  now: Date = new Date()
): ConsentState {
  const expires = consentExpiresAt ? Date.parse(consentExpiresAt) : NaN;
  if (!Number.isFinite(expires)) return { state: "unknown", daysLeft: null };
  const msLeft = expires - now.getTime();
  const daysLeft = Math.floor(msLeft / (24 * 60 * 60 * 1000));
  if (msLeft <= 0) return { state: "expired", daysLeft: 0 };
  if (daysLeft <= CONSENT_WARNING_DAYS) return { state: "expiring", daysLeft };
  return { state: "active", daysLeft };
}

// -------------------------------------------------------------- agreement math

/** Hard API maximums (docs: end-user agreements). */
const MAX_ACCESS_VALID_FOR_DAYS = 180;
const MAX_HISTORICAL_DAYS = 730;

export interface AgreementRequest {
  maxHistoricalDays: number;
  accessValidForDays: number;
}

/**
 * Sizes an end-user agreement to what the institution supports: full history
 * (capped at the API max) and the longest consent the bank allows (max 180
 * days). Values must not exceed the institution's own limits or the API
 * rejects the agreement.
 */
export function agreementFor(institution: GcInstitution): AgreementRequest {
  const historical = Number(institution.transaction_total_days);
  const access = Number(institution.max_access_valid_for_days);
  return {
    maxHistoricalDays:
      Number.isFinite(historical) && historical > 0
        ? Math.min(historical, MAX_HISTORICAL_DAYS)
        : DEFAULT_HISTORICAL_DAYS,
    accessValidForDays:
      Number.isFinite(access) && access > 0
        ? Math.min(access, MAX_ACCESS_VALID_FOR_DAYS)
        : DEFAULT_HISTORICAL_DAYS,
  };
}
