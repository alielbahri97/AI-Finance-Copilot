import { describe, expect, it } from "vitest";

import type { AiChatMessage, AiClient } from "@/lib/ai/types";
import { AiError, messagesHaveImages } from "@/lib/ai/types";
import {
  extractFirstJsonObject,
  lowConfidenceFields,
  normalizeCurrencyCode,
  normalizeDateString,
  parseAmountLoose,
  parseExtractionOutput,
  planVisionExtraction,
  stripTrailingCommas,
  validateArithmetic,
  type ExtractedInvoice,
} from "@/lib/invoices/extraction-core";
import {
  extractInvoiceFromImage,
  extractInvoiceFromText,
} from "@/lib/invoices/extraction";

/* ------------------------------------------------------------------ */
/* Realistic model-output fixtures                                     */
/* ------------------------------------------------------------------ */

const VALID_JSON = `{
  "vendor": "Acme B.V.",
  "invoiceNumber": "INV-2026-042",
  "invoiceDate": "2026-07-01",
  "dueDate": "2026-07-31",
  "currency": "EUR",
  "subtotal": 1000,
  "vatAmount": 210,
  "vatRate": 21,
  "total": 1210,
  "lineItems": [
    { "description": "Consulting", "quantity": 10, "unitPrice": 100, "total": 1000 }
  ],
  "confidence": { "vendor": 0.95, "total": 0.9, "dueDate": 0.4 }
}`;

const FENCED_OUTPUT = "```json\n" + VALID_JSON + "\n```";
const FENCED_NO_LANG = "```\n" + VALID_JSON + "\n```";
const PROSE_OUTPUT = `Sure! Here is the extracted invoice data you asked for:\n\n${VALID_JSON}\n\nLet me know if you need anything else.`;
const TRAILING_COMMA_OUTPUT = `{
  "vendor": "Acme B.V.",
  "invoiceNumber": null,
  "invoiceDate": "2026-07-01",
  "dueDate": null,
  "currency": "EUR",
  "subtotal": 100,
  "vatAmount": 21,
  "vatRate": 21,
  "total": 121,
  "lineItems": [
    { "description": "Widget", "quantity": 1, "unitPrice": 100, "total": 100, },
  ],
}`;
const LOCALIZED_OUTPUT = `{
  "vendor": "Müller GmbH",
  "invoiceNumber": "2026-117",
  "invoiceDate": "15.02.2026",
  "dueDate": "01/03/2026",
  "currency": "€",
  "subtotal": "1.234,56",
  "vatAmount": "259,26",
  "vatRate": 21,
  "total": "1.493,82",
  "lineItems": []
}`;

describe("tolerant JSON parsing", () => {
  it("parses plain strict JSON", () => {
    const result = parseExtractionOutput(VALID_JSON);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.vendor).toBe("Acme B.V.");
      expect(result.data.total).toBe(1210);
    }
  });

  it("parses fence-wrapped output (with and without language tag)", () => {
    for (const raw of [FENCED_OUTPUT, FENCED_NO_LANG]) {
      const result = parseExtractionOutput(raw);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.invoiceNumber).toBe("INV-2026-042");
    }
  });

  it("parses output with leading prose and trailing commentary", () => {
    const result = parseExtractionOutput(PROSE_OUTPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.currency).toBe("EUR");
  });

  it("parses output with trailing commas", () => {
    const result = parseExtractionOutput(TRAILING_COMMA_OUTPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.lineItems).toHaveLength(1);
      expect(result.data.total).toBe(121);
    }
  });

  it("normalizes localized numbers, dates and currency symbols", () => {
    const result = parseExtractionOutput(LOCALIZED_OUTPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.invoiceDate).toBe("2026-02-15");
      expect(result.data.dueDate).toBe("2026-03-01");
      expect(result.data.currency).toBe("EUR");
      expect(result.data.subtotal).toBeCloseTo(1234.56);
      expect(result.data.vatAmount).toBeCloseTo(259.26);
      expect(result.data.total).toBeCloseTo(1493.82);
    }
  });

  it("fails with a descriptive error when there is no JSON at all", () => {
    const result = parseExtractionOutput("I cannot read this document, sorry.");
    expect(result).toEqual({ ok: false, error: "No JSON object found in the response." });
  });

  it("reports the failing field on validation errors", () => {
    const result = parseExtractionOutput(`{ "vendor": "X", "lineItems": [{ "description": "" }] }`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("lineItems");
  });

  it("extracts the first balanced object even with braces inside strings", () => {
    const raw = `noise {"vendor": "Curly {Brace} Co", "total": 5} trailing {"other": 1}`;
    expect(extractFirstJsonObject(raw)).toBe(`{"vendor": "Curly {Brace} Co", "total": 5}`);
  });

  it("strips trailing commas only outside strings", () => {
    const json = `{"a": "1,2,", "b": [1, 2,], }`;
    expect(JSON.parse(stripTrailingCommas(json))).toEqual({ a: "1,2,", b: [1, 2] });
  });
});

describe("normalization helpers", () => {
  it("parses localized amounts", () => {
    expect(parseAmountLoose(1234.56)).toBe(1234.56);
    expect(parseAmountLoose("1234.56")).toBe(1234.56);
    expect(parseAmountLoose("1.234,56")).toBeCloseTo(1234.56);
    expect(parseAmountLoose("1,234.56")).toBeCloseTo(1234.56);
    expect(parseAmountLoose("€ 1.234,56")).toBeCloseTo(1234.56);
    expect(parseAmountLoose("21%")).toBe(21);
    expect(parseAmountLoose("-12,95")).toBeCloseTo(-12.95);
    expect(parseAmountLoose("")).toBeNull();
    expect(parseAmountLoose("n/a")).toBeNull();
    expect(parseAmountLoose(null)).toBeNull();
  });

  it("normalizes dates from common formats", () => {
    expect(normalizeDateString("2026-07-01")).toBe("2026-07-01");
    expect(normalizeDateString("2026-07-01T00:00:00Z")).toBe("2026-07-01");
    expect(normalizeDateString("15.02.2026")).toBe("2026-02-15");
    expect(normalizeDateString("15/02/2026")).toBe("2026-02-15");
    // Unambiguous month-first: the second slot exceeds 12.
    expect(normalizeDateString("02/15/2026")).toBe("2026-02-15");
    // Ambiguous defaults to day-first.
    expect(normalizeDateString("03/04/2026")).toBe("2026-04-03");
    expect(normalizeDateString("Feb 15, 2026")).toBe("2026-02-15");
    expect(normalizeDateString("15 Feb 2026")).toBe("2026-02-15");
    expect(normalizeDateString("15 February 2026")).toBe("2026-02-15");
    // Impossible dates are rejected, not rolled over.
    expect(normalizeDateString("2026-02-30")).toBeNull();
    expect(normalizeDateString("soon")).toBeNull();
  });

  it("normalizes currency symbols and codes", () => {
    expect(normalizeCurrencyCode("EUR")).toBe("EUR");
    expect(normalizeCurrencyCode("eur")).toBe("EUR");
    expect(normalizeCurrencyCode("€")).toBe("EUR");
    expect(normalizeCurrencyCode("£")).toBe("GBP");
    expect(normalizeCurrencyCode("US$")).toBe("USD");
    expect(normalizeCurrencyCode("bananas")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Arithmetic validation                                               */
/* ------------------------------------------------------------------ */

function invoiceFixture(overrides: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    vendor: "Acme",
    invoiceNumber: "1",
    invoiceDate: "2026-07-01",
    dueDate: "2026-07-31",
    currency: "EUR",
    subtotal: 100,
    vatAmount: 21,
    vatRate: 21,
    total: 121,
    lineItems: [{ description: "Widget", quantity: 2, unitPrice: 50, total: 100 }],
    confidence: null,
    ...overrides,
  };
}

describe("arithmetic validation", () => {
  it("accepts a consistent invoice", () => {
    expect(validateArithmetic(invoiceFixture())).toEqual([]);
  });

  it("tolerates cent-level rounding", () => {
    const extracted = invoiceFixture({
      subtotal: 33.06,
      vatAmount: 6.94,
      total: 40.01,
      lineItems: [{ description: "Thing", quantity: 3, unitPrice: 11.02, total: 33.05 }],
    });
    expect(validateArithmetic(extracted)).toEqual([]);
  });

  it("flags quantity × unit price mismatches on line items", () => {
    const extracted = invoiceFixture({
      lineItems: [{ description: "Widget", quantity: 2, unitPrice: 50, total: 150 }],
      subtotal: null,
      vatAmount: null,
      vatRate: null,
      total: null,
    });
    const warnings = validateArithmetic(extracted);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2 × 50");
  });

  it("flags subtotal + VAT ≠ total", () => {
    const extracted = invoiceFixture({ total: 130, lineItems: [] });
    const warnings = validateArithmetic(extracted);
    expect(warnings.some((warning) => warning.includes("total reads 130.00"))).toBe(true);
  });

  it("flags VAT amounts inconsistent with the rate", () => {
    const extracted = invoiceFixture({ vatAmount: 50, total: 150, lineItems: [] });
    const warnings = validateArithmetic(extracted);
    expect(warnings.some((warning) => warning.includes("21% VAT"))).toBe(true);
  });

  it("flags line totals that don't add up to the subtotal", () => {
    const extracted = invoiceFixture({
      lineItems: [
        { description: "A", quantity: 1, unitPrice: 30, total: 30 },
        { description: "B", quantity: 1, unitPrice: 30, total: 30 },
      ],
    });
    const warnings = validateArithmetic(extracted);
    expect(warnings.some((warning) => warning.includes("add up to 60.00"))).toBe(true);
  });
});

describe("field-level confidence", () => {
  it("flags filled fields the model was unsure about", () => {
    const extracted = invoiceFixture({
      confidence: { vendor: 0.3, total: 0.95, dueDate: 0.5 },
    });
    expect(lowConfidenceFields(extracted)).toEqual(["vendor", "dueDate"]);
  });

  it("does not flag absent fields or invoices without a confidence map", () => {
    expect(lowConfidenceFields(invoiceFixture())).toEqual([]);
    const extracted = invoiceFixture({ dueDate: null, confidence: { dueDate: 0.1 } });
    expect(lowConfidenceFields(extracted)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Vision routing decisions                                            */
/* ------------------------------------------------------------------ */

describe("vision routing plan", () => {
  it("keeps a vision-capable preferred provider first", () => {
    const plan = planVisionExtraction([
      { provider: "groq", visionModel: "qwen/qwen3.6-27b" },
      { provider: "openai", visionModel: "gpt-4o-mini" },
    ]);
    expect(plan).toEqual({
      ok: true,
      order: [
        { provider: "groq", visionModel: "qwen/qwen3.6-27b" },
        { provider: "openai", visionModel: "gpt-4o-mini" },
      ],
    });
  });

  it("skips providers without vision and falls back to capable ones", () => {
    const plan = planVisionExtraction([
      { provider: "groq", visionModel: null },
      { provider: "anthropic", visionModel: "claude-3-5-haiku-latest" },
    ]);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.order.map((candidate) => candidate.provider)).toEqual(["anthropic"]);
  });

  it("fails with an actionable reason when no provider can read images", () => {
    const plan = planVisionExtraction([{ provider: "groq", visionModel: null }]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toContain("groq");
      expect(plan.reason).toContain("vision");
    }
  });

  it("fails with a setup hint when no provider is configured at all", () => {
    const plan = planVisionExtraction([]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("GROQ_API_KEY");
  });
});

/* ------------------------------------------------------------------ */
/* Extraction runner (fake clients)                                    */
/* ------------------------------------------------------------------ */

function fakeClient(options: {
  provider: "openai" | "anthropic" | "groq";
  visionModel?: string | null;
  replies?: string[];
  error?: Error;
  calls?: AiChatMessage[][];
}): AiClient {
  const replies = [...(options.replies ?? [])];
  return {
    provider: options.provider,
    model: `${options.provider}-text`,
    visionModel: options.visionModel === undefined ? `${options.provider}-vision` : options.visionModel,
    async chat(messages) {
      options.calls?.push(messages);
      if (options.error) throw options.error;
      const reply = replies.shift();
      if (!reply) throw new Error("fake client ran out of replies");
      return reply;
    },
    async *chatStream() {
      yield "";
    },
  };
}

const IMAGE_BYTES = Buffer.from("fake-image-data");

describe("extraction runner", () => {
  it("extracts an image via the preferred provider's vision model", async () => {
    const calls: AiChatMessage[][] = [];
    const groq = fakeClient({ provider: "groq", replies: [FENCED_OUTPUT], calls });
    const result = await extractInvoiceFromImage([groq], "image/png", IMAGE_BYTES);
    expect(result.extracted?.vendor).toBe("Acme B.V.");
    expect(result.provider).toBe("groq");
    expect(result.model).toBe("groq-vision");
    expect(result.failureReason).toBeNull();
    expect(messagesHaveImages(calls[0])).toBe(true);
  });

  it("falls back to the next vision provider when the first fails", async () => {
    const groq = fakeClient({
      provider: "groq",
      error: new AiError("Groq is rate-limiting requests.", 429),
    });
    const openai = fakeClient({ provider: "openai", replies: [VALID_JSON] });
    const result = await extractInvoiceFromImage([groq, openai], "image/jpeg", IMAGE_BYTES);
    expect(result.extracted?.total).toBe(1210);
    expect(result.provider).toBe("openai");
  });

  it("returns a clear reason when the only provider has no vision model", async () => {
    const groq = fakeClient({ provider: "groq", visionModel: null });
    const result = await extractInvoiceFromImage([groq], "image/png", IMAGE_BYTES);
    expect(result.extracted).toBeNull();
    expect(result.failureReason).toContain("vision-capable");
  });

  it("rejects oversized images with an actionable message", async () => {
    const groq = fakeClient({ provider: "groq", replies: [VALID_JSON] });
    const huge = Buffer.alloc(9 * 1024 * 1024);
    const result = await extractInvoiceFromImage([groq], "image/png", huge);
    expect(result.extracted).toBeNull();
    expect(result.failureReason).toContain("too large");
  });

  it("retries once with validation feedback, then succeeds", async () => {
    const calls: AiChatMessage[][] = [];
    const groq = fakeClient({
      provider: "groq",
      replies: ["The invoice shows a payment. No JSON here!", VALID_JSON],
      calls,
    });
    const result = await extractInvoiceFromText([groq], "Invoice text");
    expect(result.extracted?.vendor).toBe("Acme B.V.");
    expect(calls).toHaveLength(2);
    const retryPrompt = calls[1].at(-1);
    expect(String(retryPrompt?.content)).toContain("rejected");
  });

  it("reports a combined failure reason when every provider fails", async () => {
    const groq = fakeClient({
      provider: "groq",
      error: new AiError("Groq rejected the API key. Check GROQ_API_KEY in your environment.", 401),
    });
    const result = await extractInvoiceFromText([groq], "Invoice text");
    expect(result.extracted).toBeNull();
    expect(result.failureReason).toContain("GROQ_API_KEY");
  });

  it("explains missing configuration for text extraction", async () => {
    const result = await extractInvoiceFromText([], "Invoice text");
    expect(result.extracted).toBeNull();
    expect(result.failureReason).toContain("No AI provider is configured");
  });
});
