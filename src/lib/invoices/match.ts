import { normalizeMerchant } from "@/lib/finance/recurrence";

/**
 * Suggests bank transactions that likely settle an invoice. Deterministic
 * scoring: amount closeness (dominant), date proximity to the invoice/due
 * date, and vendor vs counterparty/description text similarity.
 */

export interface MatchInvoice {
  total: number;
  vendor: string;
  invoiceDate: Date | null;
  dueDate: Date | null;
}

export interface MatchCandidate {
  id: string;
  amount: number;
  date: Date;
  description: string;
  counterparty: string | null;
}

export interface MatchSuggestion {
  transactionId: string;
  score: number;
  amountDiff: number;
  daysApart: number | null;
  vendorSimilarity: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS_APART = 60;

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeMerchant(value)
      .split(" ")
      .filter((token) => token.length >= 3)
  );
}

/** Fraction of the vendor's tokens found in the transaction's text (0..1). */
function vendorSimilarity(vendor: string, candidate: MatchCandidate): number {
  const vendorTokens = tokenSet(vendor);
  if (vendorTokens.size === 0) return 0;
  const candidateTokens = tokenSet(`${candidate.counterparty ?? ""} ${candidate.description}`);
  let hits = 0;
  for (const token of vendorTokens) {
    if (candidateTokens.has(token)) hits++;
  }
  return hits / vendorTokens.size;
}

export function suggestMatches(
  invoice: MatchInvoice,
  candidates: MatchCandidate[],
  limit = 5
): MatchSuggestion[] {
  if (invoice.total <= 0) return [];

  const referenceDates = [invoice.invoiceDate, invoice.dueDate].filter(
    (date): date is Date => date !== null
  );

  const suggestions: MatchSuggestion[] = [];

  for (const candidate of candidates) {
    const amountDiff = Math.abs(candidate.amount - invoice.total);
    const relativeDiff = amountDiff / invoice.total;
    // Hard gate: the amount must be close (within 3% or 1 currency unit).
    if (relativeDiff > 0.03 && amountDiff > 1) continue;
    const amountScore = Math.max(0, 1 - relativeDiff / 0.03);

    let daysApart: number | null = null;
    let dateScore = 0.5; // neutral when the invoice has no dates
    if (referenceDates.length > 0) {
      daysApart = Math.min(
        ...referenceDates.map((date) =>
          Math.abs(Math.round((candidate.date.getTime() - date.getTime()) / MS_PER_DAY))
        )
      );
      if (daysApart > MAX_DAYS_APART) continue;
      dateScore = 1 - daysApart / MAX_DAYS_APART;
    }

    const similarity = vendorSimilarity(invoice.vendor, candidate);

    suggestions.push({
      transactionId: candidate.id,
      score: Math.round((0.5 * amountScore + 0.25 * dateScore + 0.25 * similarity) * 100) / 100,
      amountDiff: Math.round(amountDiff * 100) / 100,
      daysApart,
      vendorSimilarity: Math.round(similarity * 100) / 100,
    });
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}
