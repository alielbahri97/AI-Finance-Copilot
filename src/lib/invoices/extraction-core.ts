import { z } from "zod";

import { detectNumberFormat, parseLocalizedNumber } from "@/lib/csv/detect";
import { parseCurrencyCode } from "@/lib/currency/parse";

/**
 * Pure invoice-extraction logic: tolerant JSON parsing of model output,
 * field normalization (localized numbers, dates, currency symbols),
 * arithmetic validation and vision-provider routing decisions. No AI or DB
 * calls — fully unit-testable.
 */

/* ------------------------------------------------------------------ */
/* Field normalization                                                 */
/* ------------------------------------------------------------------ */

/**
 * Parses a number that may arrive as a localized string ("1.234,56",
 * "€ 1,234.56", "1 234,56") instead of a plain JSON number.
 */
export function parseAmountLoose(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "") return null;

  const direct = Number(raw);
  if (!Number.isNaN(direct)) return direct;

  return parseLocalizedNumber(raw, detectNumberFormat([raw]));
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function toIso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject rollovers like Feb 30.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Normalizes a date string into ISO `YYYY-MM-DD`. Accepts ISO, `D.M.YYYY` /
 * `D-M-YYYY` / `D/M/YYYY` (day-first unless the day slot exceeds 12 in the
 * month slot's place), and month-name forms ("15 Feb 2026", "Feb 15, 2026").
 */
export function normalizeDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "") return null;

  // ISO (possibly with a time suffix).
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Month-name forms.
  const monthName = raw
    .toLowerCase()
    .match(/^(?:(\d{1,2})\s+)?([a-z]{3,9})\.?\s+(\d{1,2},?\s+)?(\d{4})$/);
  if (monthName) {
    const month = MONTH_NAMES[monthName[2].slice(0, 3)];
    const day = Number(monthName[1] ?? monthName[3]?.replace(",", "").trim());
    if (month && Number.isFinite(day)) return toIso(Number(monthName[4]), month, day);
  }

  // Numeric D/M/Y, D.M.Y, D-M-Y (and Y first).
  const parts = raw.split(/[./\-\s]+/).filter(Boolean);
  if (parts.length === 3 && parts.every((part) => /^\d{1,4}$/.test(part))) {
    const numbers = parts.map(Number);
    if (parts[0].length === 4) {
      return toIso(numbers[0], numbers[1], numbers[2]);
    }
    if (parts[2].length === 4 || parts[2].length === 2) {
      const year = parts[2].length === 2 ? 2000 + numbers[2] : numbers[2];
      const [a, b] = numbers;
      // Disambiguate: a>12 must be the day; b>12 must mean month-first.
      if (a > 12) return toIso(year, b, a);
      if (b > 12) return toIso(year, a, b);
      // Ambiguous: default to day-first (European invoices dominate here).
      return toIso(year, b, a);
    }
  }

  return null;
}

/** Normalizes a currency value ("€", "eur", "US$", "EUR 21%") to an ISO code. */
export function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = parseCurrencyCode(value);
  if (parsed) return parsed;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
}

/* ------------------------------------------------------------------ */
/* Extraction schema (with normalization preprocessors)                */
/* ------------------------------------------------------------------ */

const looseAmount = z.preprocess(
  (value) => (value === null || value === undefined ? null : parseAmountLoose(value)),
  z.number().nullable()
);

const looseDate = z.preprocess(
  (value) => (value === null || value === undefined ? null : normalizeDateString(value)),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
);

const looseCurrency = z.preprocess(
  (value) => (value === null || value === undefined ? null : normalizeCurrencyCode(value)),
  z.string().regex(/^[A-Z]{3}$/).nullable()
);

const confidenceValue = z.coerce.number().min(0).max(1);

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: looseAmount.pipe(z.number().nonnegative().max(1_000_000).nullable()).nullish(),
  unitPrice: looseAmount.nullish(),
  total: looseAmount.nullish(),
});

export const extractionSchema = z.object({
  vendor: z.string().trim().max(200).nullish(),
  invoiceNumber: z.coerce.string().trim().max(100).nullish(),
  invoiceDate: looseDate.nullish(),
  dueDate: looseDate.nullish(),
  currency: looseCurrency.nullish(),
  subtotal: looseAmount.nullish(),
  vatAmount: looseAmount.nullish(),
  vatRate: looseAmount.pipe(z.number().min(0).max(100).nullable()).nullish(),
  total: looseAmount.nullish(),
  lineItems: z.array(lineItemSchema).max(100).nullish(),
  /** Per-field confidence 0..1, as reported by the model. */
  confidence: z.record(z.string(), confidenceValue).nullish(),
});

export type ExtractedInvoice = z.infer<typeof extractionSchema>;

/* ------------------------------------------------------------------ */
/* Tolerant JSON parsing of model output                               */
/* ------------------------------------------------------------------ */

/**
 * Finds the first balanced JSON object in free-form model output. Tolerates
 * markdown fences, leading prose ("Here is the extracted data:") and
 * trailing commentary. String-aware, so braces inside values don't confuse it.
 */
export function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** Removes trailing commas before `}` / `]` (string-aware). */
export function stripTrailingCommas(json: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === ",") {
      // Look ahead past whitespace for a closing bracket.
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j])) j++;
      if (json[j] === "}" || json[j] === "]") continue; // drop the comma
    }
    result += char;
  }
  return result;
}

export type ParseOutcome =
  | { ok: true; data: ExtractedInvoice }
  | { ok: false; error: string };

/**
 * Parses model output into a validated extraction. Tolerates fences, prose
 * and trailing commas; normalizes localized numbers/dates/currency symbols.
 * On failure, returns a description usable in the retry prompt.
 */
export function parseExtractionOutput(raw: string): ParseOutcome {
  const candidate = extractFirstJsonObject(raw);
  if (!candidate) {
    return { ok: false, error: "No JSON object found in the response." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    try {
      parsed = JSON.parse(stripTrailingCommas(candidate));
    } catch (error) {
      return {
        ok: false,
        error: `The JSON object is malformed: ${error instanceof Error ? error.message : "parse error"}.`,
      };
    }
  }

  const result = extractionSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `Fields failed validation — ${issues}.` };
  }
  return { ok: true, data: result.data };
}

/* ------------------------------------------------------------------ */
/* Arithmetic validation                                               */
/* ------------------------------------------------------------------ */

function approxEqual(a: number, b: number): boolean {
  // Absolute 2-cent tolerance plus 1% relative for rounding chains.
  return Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.01);
}

/**
 * Cross-checks the extracted amounts. Returns human-readable warnings; any
 * warning means the invoice should be flagged for review rather than saved
 * silently with wrong numbers.
 */
export function validateArithmetic(extracted: ExtractedInvoice): string[] {
  const warnings: string[] = [];
  const items = extracted.lineItems ?? [];

  items.forEach((item, index) => {
    if (item.quantity != null && item.unitPrice != null && item.total != null) {
      const computed = item.quantity * item.unitPrice;
      if (!approxEqual(computed, item.total)) {
        warnings.push(
          `Line ${index + 1} ("${item.description.slice(0, 40)}"): ${item.quantity} × ${item.unitPrice} = ${computed.toFixed(2)}, but the line total reads ${item.total.toFixed(2)}.`
        );
      }
    }
  });

  const lineTotals = items.filter((item) => item.total != null);
  if (lineTotals.length > 0 && lineTotals.length === items.length && extracted.subtotal != null) {
    const sum = lineTotals.reduce((acc, item) => acc + (item.total as number), 0);
    if (!approxEqual(sum, extracted.subtotal) && !approxEqual(sum, extracted.total ?? NaN)) {
      warnings.push(
        `Line items add up to ${sum.toFixed(2)}, but the subtotal reads ${extracted.subtotal.toFixed(2)}.`
      );
    }
  }

  if (extracted.subtotal != null && extracted.vatAmount != null && extracted.total != null) {
    const computed = extracted.subtotal + extracted.vatAmount;
    if (!approxEqual(computed, extracted.total)) {
      warnings.push(
        `Subtotal ${extracted.subtotal.toFixed(2)} + VAT ${extracted.vatAmount.toFixed(2)} = ${computed.toFixed(2)}, but the total reads ${extracted.total.toFixed(2)}.`
      );
    }
  }

  if (extracted.subtotal != null && extracted.vatRate != null && extracted.vatAmount != null) {
    const computed = (extracted.subtotal * extracted.vatRate) / 100;
    if (!approxEqual(computed, extracted.vatAmount)) {
      warnings.push(
        `${extracted.vatRate}% VAT on ${extracted.subtotal.toFixed(2)} is ${computed.toFixed(2)}, but the VAT amount reads ${extracted.vatAmount.toFixed(2)}.`
      );
    }
  }

  return warnings;
}

/* ------------------------------------------------------------------ */
/* Field-level confidence                                              */
/* ------------------------------------------------------------------ */

export const CONFIDENCE_REVIEW_THRESHOLD = 0.6;

const CONFIDENCE_FIELDS = [
  "vendor",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "currency",
  "subtotal",
  "vatAmount",
  "vatRate",
  "total",
] as const;

/**
 * Fields the user should double-check: reported confidence below the
 * threshold, or a value present without any confidence signal at all is NOT
 * flagged (older/other models may omit the map entirely).
 */
export function lowConfidenceFields(extracted: ExtractedInvoice): string[] {
  const confidence = extracted.confidence;
  if (!confidence) return [];
  return CONFIDENCE_FIELDS.filter((field) => {
    const value = extracted[field];
    if (value === null || value === undefined) return false;
    const score = confidence[field];
    return typeof score === "number" && score < CONFIDENCE_REVIEW_THRESHOLD;
  });
}

/* ------------------------------------------------------------------ */
/* Vision routing                                                      */
/* ------------------------------------------------------------------ */

export interface VisionCandidate {
  provider: "openai" | "anthropic" | "groq";
  /** null = provider cannot read images. */
  visionModel: string | null;
}

export type VisionPlan =
  | { ok: true; order: VisionCandidate[] }
  | { ok: false; reason: string };

/**
 * Decides which providers to try for image extraction, in order. `clients`
 * must already be in preference order (preferred provider first). Providers
 * without a vision-capable model are skipped; when none qualifies the plan
 * fails with an actionable reason.
 */
export function planVisionExtraction(clients: VisionCandidate[]): VisionPlan {
  const capable = clients.filter((client) => client.visionModel !== null);
  if (capable.length > 0) return { ok: true, order: capable };

  if (clients.length === 0) {
    return {
      ok: false,
      reason:
        "No AI provider is configured. An administrator can set GROQ_API_KEY (free), OPENAI_API_KEY or ANTHROPIC_API_KEY to enable extraction.",
    };
  }
  return {
    ok: false,
    reason: `None of the configured AI providers (${clients
      .map((client) => client.provider)
      .join(", ")}) has a vision-capable model, so image documents can't be read. An administrator can add an OpenAI or Anthropic key, or set GROQ_VISION_MODEL.`,
  };
}
