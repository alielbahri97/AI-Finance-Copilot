/**
 * Heuristics for spotting money moving between the user's own accounts
 * (current ↔ savings, etc.). Pure — no DB — so import, AI categorize and
 * unit tests share one definition of "this is an internal transfer".
 *
 * TransactionType is only INCOME | EXPENSE, so transfers are still stored as
 * one of those directions and tagged with a Transfer / Transfer in category
 * rather than a third type.
 */

export const TRANSFER_CATEGORY_EXPENSE = "Transfer";
export const TRANSFER_CATEGORY_INCOME = "Transfer in";

/** Names we seed (and recognise) as non-spend movements. */
export const TRANSFER_CATEGORY_NAMES = [
  TRANSFER_CATEGORY_EXPENSE,
  TRANSFER_CATEGORY_INCOME,
] as const;

/**
 * Phrases that almost always mean money between the user's own accounts —
 * enough on their own to classify without a linked IBAN/name match.
 */
const STRONG_TRANSFER_PHRASES = [
  "eigen rekening",
  "own account",
  "own accounts",
  "interne overboeking",
  "internal transfer",
  "tussen eigen rekeningen",
  "between my accounts",
  "between own accounts",
  "to my savings",
  "from my savings",
  "naar spaarrekening",
  "van spaarrekening",
  "to savings account",
  "from savings account",
  "checking to savings",
  "savings to checking",
  "current to savings",
  "savings to current",
  "betaalrekening naar spaar",
  "spaar naar betaal",
] as const;

/**
 * Weaker cues that only count when an own-account IBAN/name/mask also appears.
 * Alone they are too common (vendor "bank transfer", generic "savings").
 */
const WEAK_TRANSFER_PHRASES = [
  "overboeking",
  "spaarrekening",
  "savings account",
  "to savings",
  "from savings",
  "naar spaar",
  "van spaar",
  "transfer to",
  "transfer from",
] as const;

/** Account labels too generic to treat as a unique counterparty match. */
const GENERIC_ACCOUNT_LABELS = new Set([
  "account",
  "bank",
  "bank account",
  "current",
  "current account",
  "checking",
  "checking account",
  "savings",
  "savings account",
  "spaarrekening",
  "betaalrekening",
  "main",
  "main account",
  "primary",
  "primary account",
]);

export interface OwnAccountRef {
  /** Provider-supplied account name, when available. */
  name: string | null;
  /** Masked identifier like "…1234"; never a full IBAN in storage. */
  mask: string | null;
}

/** True when the category name is one of our transfer buckets (any casing). */
export function isTransferCategoryName(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  return (
    normalized === TRANSFER_CATEGORY_EXPENSE.toLowerCase() ||
    normalized === TRANSFER_CATEGORY_INCOME.toLowerCase() ||
    normalized === "internal transfer" ||
    normalized === "savings / transfer" ||
    normalized === "savings/transfer"
  );
}

/** Category name for a given transaction direction. */
export function transferCategoryNameFor(type: "INCOME" | "EXPENSE"): string {
  return type === "INCOME" ? TRANSFER_CATEGORY_INCOME : TRANSFER_CATEGORY_EXPENSE;
}

/** Strips spaces/dashes and uppercases an IBAN-like token. */
export function normalizeIban(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Published IBAN lengths by country (ISO 13616). When present we clip a greedy
 * match to this length so remittance words ("spaar", "savings") are not eaten.
 */
const IBAN_LENGTH_BY_COUNTRY: Record<string, number> = {
  AL: 28,
  AD: 24,
  AT: 20,
  AZ: 28,
  BE: 16,
  BH: 22,
  BA: 20,
  BR: 29,
  BG: 22,
  CR: 22,
  HR: 21,
  CY: 28,
  CZ: 24,
  DK: 18,
  DO: 28,
  EE: 20,
  FO: 18,
  FI: 18,
  FR: 27,
  GE: 22,
  DE: 22,
  GI: 23,
  GR: 27,
  GL: 18,
  GT: 28,
  HU: 28,
  IS: 26,
  IE: 22,
  IL: 23,
  IT: 27,
  JO: 30,
  KZ: 20,
  XK: 20,
  KW: 30,
  LV: 21,
  LB: 28,
  LI: 21,
  LT: 20,
  LU: 20,
  MK: 19,
  MT: 31,
  MR: 27,
  MU: 30,
  MD: 24,
  MC: 27,
  ME: 22,
  NL: 18,
  NO: 15,
  PK: 24,
  PS: 29,
  PL: 28,
  PT: 25,
  QA: 29,
  RO: 24,
  SM: 27,
  SA: 24,
  RS: 22,
  SK: 24,
  SI: 19,
  ES: 24,
  SE: 24,
  CH: 21,
  TL: 23,
  TN: 24,
  TR: 26,
  AE: 23,
  GB: 22,
  VG: 24,
};

function clipIban(candidate: string): string | null {
  if (candidate.length < 15 || candidate.length > 34) return null;
  const expected = IBAN_LENGTH_BY_COUNTRY[candidate.slice(0, 2)];
  if (expected) {
    if (candidate.length < expected) return null;
    return candidate.slice(0, expected);
  }
  return candidate;
}

/**
 * Finds IBAN-shaped tokens in free text (CSV remittance lines, PSD2 fields).
 * Accepts optional spaces between character groups.
 */
export function extractIbans(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\b[A-Z]{2}\s*\d{2}(?:[\s-]*[A-Z0-9]){10,30}\b/gi) ?? [];
  const seen = new Set<string>();
  const ibans: string[] = [];
  for (const match of matches) {
    const iban = clipIban(normalizeIban(match));
    if (!iban) continue;
    if (seen.has(iban)) continue;
    seen.add(iban);
    ibans.push(iban);
  }
  return ibans;
}

/** Last four alphanumeric characters from a mask ("…1234") or raw IBAN. */
export function accountLast4(maskOrIban: string | null | undefined): string | null {
  if (!maskOrIban) return null;
  const digits = maskOrIban.replace(/[^a-zA-Z0-9]/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4).toUpperCase();
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function haystackOf(description: string, counterparty: string | null): string {
  return `${description} ${counterparty ?? ""}`.trim();
}

function containsPhrase(haystackLower: string, phrase: string): boolean {
  return haystackLower.includes(phrase);
}

/**
 * Whether `needle` appears as a whole-ish phrase in `haystack` (case-folded).
 * Requires length ≥ 5 and skips generic labels so "Savings" alone never fires.
 */
export function accountNameMatches(haystack: string, accountName: string | null | undefined): boolean {
  if (!accountName) return false;
  const needle = normalizeLabel(accountName);
  if (needle.length < 5) return false;
  if (GENERIC_ACCOUNT_LABELS.has(needle)) return false;
  const hay = normalizeLabel(haystack);
  if (!hay) return false;
  return hay === needle || hay.includes(needle);
}

/**
 * True when the text references one of the workspace's linked accounts by
 * IBAN (full or last-4 via mask) or by a distinctive account name.
 */
export function matchesOwnAccount(
  description: string,
  counterparty: string | null,
  accounts: OwnAccountRef[]
): boolean {
  if (accounts.length === 0) return false;
  const haystack = haystackOf(description, counterparty);
  if (!haystack) return false;

  const ibans = extractIbans(haystack);
  const ibanLast4 = new Set(ibans.map((iban) => iban.slice(-4)));
  const hayLower = haystack.toLowerCase();

  for (const account of accounts) {
    const last4 = accountLast4(account.mask);
    if (last4 && ibanLast4.has(last4)) return true;
    // Literal mask echo in the description ("…1234" / "...1234").
    if (last4 && (hayLower.includes(`…${last4.toLowerCase()}`) || hayLower.includes(`...${last4.toLowerCase()}`))) {
      return true;
    }
    if (accountNameMatches(haystack, account.name)) return true;
  }

  return false;
}

function hasStrongTransferPhrase(haystackLower: string): boolean {
  return STRONG_TRANSFER_PHRASES.some((phrase) => containsPhrase(haystackLower, phrase));
}

function hasWeakTransferPhrase(haystackLower: string): boolean {
  return WEAK_TRANSFER_PHRASES.some((phrase) => containsPhrase(haystackLower, phrase));
}

/**
 * Detects an internal transfer: strong wording, or a linked-account match
 * (optionally reinforced by weaker transfer wording).
 */
export function isInternalTransfer(
  description: string,
  counterparty: string | null,
  accounts: OwnAccountRef[]
): boolean {
  const haystack = haystackOf(description, counterparty);
  if (!haystack) return false;
  const hayLower = haystack.toLowerCase();

  if (hasStrongTransferPhrase(hayLower)) return true;

  const own = matchesOwnAccount(description, counterparty, accounts);
  if (!own) return false;

  // Own-account hit is enough when there are ≥2 linked accounts (typical
  // current+savings). With a single linked account, require transfer wording
  // so a payment *to* someone who happens to share a last-4 is not tagged.
  if (accounts.length >= 2) return true;
  return hasWeakTransferPhrase(hayLower) || hasStrongTransferPhrase(hayLower);
}
