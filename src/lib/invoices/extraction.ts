import "server-only";

import { z } from "zod";

import type { AiClient, AiContentPart } from "@/lib/ai";

/**
 * Structured invoice extraction via the shared AI provider abstraction.
 * Images go to the provider's vision capability; PDFs are converted to text
 * first (see pdf.ts) and sent as plain text. The model must answer with
 * strict JSON which is validated with Zod; one retry on invalid output.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().nonnegative().max(1_000_000).nullish(),
  unitPrice: z.coerce.number().nullish(),
  total: z.coerce.number().nullish(),
});

const extractionSchema = z.object({
  vendor: z.string().trim().max(200).nullish(),
  invoiceNumber: z.string().trim().max(100).nullish(),
  invoiceDate: z.string().regex(ISO_DATE).nullish(),
  dueDate: z.string().regex(ISO_DATE).nullish(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .nullish(),
  subtotal: z.coerce.number().nullish(),
  vatAmount: z.coerce.number().nullish(),
  vatRate: z.coerce.number().min(0).max(100).nullish(),
  total: z.coerce.number().nullish(),
  lineItems: z.array(lineItemSchema).max(100).nullish(),
});

export type ExtractedInvoice = z.infer<typeof extractionSchema>;

const SYSTEM_PROMPT = `You extract structured data from invoices and receipts.

Reply with ONLY a JSON object (no markdown fences, no commentary) with exactly these keys:
{
  "vendor": string | null,          // the party that issued the invoice
  "invoiceNumber": string | null,
  "invoiceDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "currency": string | null,        // 3-letter ISO code, e.g. "EUR". Infer from symbols (€→EUR, £→GBP, $→USD unless another currency is named) or explicit codes.
  "subtotal": number | null,        // amount excluding VAT/tax
  "vatAmount": number | null,
  "vatRate": number | null,         // percent, e.g. 21
  "total": number | null,           // grand total including VAT/tax
  "lineItems": [                    // [] if none are identifiable
    { "description": string, "quantity": number | null, "unitPrice": number | null, "total": number | null }
  ]
}

Rules:
- Use null for anything not present in the document. Never guess or invent values.
- Numbers must be plain JSON numbers (no currency symbols or thousands separators).
- Always set "currency" when a currency symbol or ISO code appears anywhere on the document (€, £, $, USD, EUR, GBP, CHF, etc.).
- Interpret ambiguous date formats using context (a due date is never before the invoice date).
- If the document is not an invoice or receipt, return all fields null with an empty lineItems array.`;

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function parseExtraction(raw: string): ExtractedInvoice | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    return null;
  }
  const result = extractionSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

async function runExtraction(
  ai: AiClient,
  userContent: string | AiContentPart[]
): Promise<ExtractedInvoice | null> {
  const first = await ai.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    { temperature: 0, maxTokens: 3000 }
  );

  const parsed = parseExtraction(first);
  if (parsed) return parsed;

  // One retry: show the model its invalid output and demand strict JSON.
  const second = await ai.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
      { role: "assistant", content: first.slice(0, 4000) },
      {
        role: "user",
        content:
          "That response was not valid JSON matching the required shape. Reply again with ONLY the JSON object — no explanations, no markdown fences.",
      },
    ],
    { temperature: 0, maxTokens: 3000 }
  );

  return parseExtraction(second);
}

/** Extracts invoice data from an image using the provider's vision capability. */
export async function extractFromImage(
  ai: AiClient,
  mediaType: string,
  dataBase64: string
): Promise<ExtractedInvoice | null> {
  return runExtraction(ai, [
    { type: "image", mediaType, dataBase64 },
    { type: "text", text: "Extract the invoice data from this document image." },
  ]);
}

/** Extracts invoice data from the text layer of a PDF. */
export async function extractFromText(
  ai: AiClient,
  text: string
): Promise<ExtractedInvoice | null> {
  return runExtraction(
    ai,
    `Extract the invoice data from this document text:\n\n${text.slice(0, 24_000)}`
  );
}
