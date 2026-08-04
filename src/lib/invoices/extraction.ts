import "server-only";

import { logger, serializeError } from "@/lib/logger";

import { AiError, type AiClient, type AiContentPart } from "@/lib/ai";

import {
  parseExtractionOutput,
  planVisionExtraction,
  type ExtractedInvoice,
} from "./extraction-core";

export type { ExtractedInvoice } from "./extraction-core";

/**
 * Server-side extraction runner: sends the document to the AI, walking the
 * configured providers in order until one succeeds, and reports which
 * provider/model handled it (or why every attempt failed) for telemetry.
 */

/** Raw image bytes above this can exceed provider request limits once base64-encoded. */
export const MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;

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
  ],
  "confidence": {                   // how certain you are about each extracted field, 0.0-1.0
    "vendor": number, "invoiceNumber": number, "invoiceDate": number, "dueDate": number,
    "currency": number, "subtotal": number, "vatAmount": number, "vatRate": number, "total": number
  }
}

Rules:
- Use null for anything not present in the document. Never guess or invent values.
- Numbers must be plain JSON numbers (no currency symbols or thousands separators). Beware of European formats: "1.234,56" means 1234.56.
- Always set "currency" when a currency symbol or ISO code appears anywhere on the document (€, £, $, USD, EUR, GBP, CHF, etc.).
- Interpret ambiguous date formats using context (a due date is never before the invoice date).
- In "confidence", rate only fields you filled; use low values (< 0.6) when the document is blurry, cropped or ambiguous for that field.
- If the document is not an invoice or receipt, return all fields null with an empty lineItems array.`;

export interface ExtractionResult {
  extracted: ExtractedInvoice | null;
  /** Provider that produced the result (or the last one attempted). */
  provider: string | null;
  /** Model that produced the result (or the last one attempted). */
  model: string | null;
  durationMs: number;
  /** Why extraction produced nothing — shown to the user on the review page. */
  failureReason: string | null;
}

async function runExtraction(
  ai: AiClient,
  userContent: string | AiContentPart[]
): Promise<{ extracted: ExtractedInvoice | null; parseError: string | null }> {
  const first = await ai.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    { temperature: 0, maxTokens: 3000, jsonMode: true }
  );

  const parsed = parseExtractionOutput(first);
  if (parsed.ok) return { extracted: parsed.data, parseError: null };

  // One retry: show the model its invalid output and the validation errors.
  const second = await ai.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
      { role: "assistant", content: first.slice(0, 4000) },
      {
        role: "user",
        content: `That response was rejected: ${parsed.error} Reply again with ONLY the JSON object — no explanations, no markdown fences, no trailing commas.`,
      },
    ],
    { temperature: 0, maxTokens: 3000, jsonMode: true }
  );

  const retried = parseExtractionOutput(second);
  if (retried.ok) return { extracted: retried.data, parseError: null };
  return {
    extracted: null,
    parseError: `The AI reply was not usable JSON after a retry (${retried.error})`,
  };
}

function describeAttemptError(client: AiClient, error: unknown): string {
  if (error instanceof AiError) return error.message;
  return `${client.provider} request failed: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Tries each client in order until one returns a valid extraction. Text
 * documents work with every chat model; callers pass vision-filtered clients
 * for images.
 */
async function extractWithFallback(
  clients: AiClient[],
  userContent: string | AiContentPart[],
  usesVision: boolean
): Promise<ExtractionResult> {
  const startedAt = Date.now();
  let lastProvider: string | null = null;
  let lastModel: string | null = null;
  const failures: string[] = [];

  for (const client of clients) {
    lastProvider = client.provider;
    lastModel = usesVision ? client.visionModel : client.model;
    try {
      const { extracted, parseError } = await runExtraction(client, userContent);
      if (extracted) {
        return {
          extracted,
          provider: client.provider,
          model: lastModel,
          durationMs: Date.now() - startedAt,
          failureReason: null,
        };
      }
      failures.push(`${client.provider}: ${parseError}`);
    } catch (error) {
      const description = describeAttemptError(client, error);
      failures.push(description);
      logger.error("invoice extraction attempt failed", {
        provider: client.provider,
        model: lastModel,
        error: serializeError(error),
      });
    }
  }

  return {
    extracted: null,
    provider: lastProvider,
    model: lastModel,
    durationMs: Date.now() - startedAt,
    failureReason: failures.length > 0 ? failures.join(" | ").slice(0, 500) : "No provider attempted",
  };
}

/**
 * Extracts invoice data from an image, routed to vision-capable models only.
 * Falls back across providers; when none can read images, fails with an
 * actionable reason instead of a provider 400.
 */
export async function extractInvoiceFromImage(
  clients: AiClient[],
  mediaType: string,
  imageBytes: Buffer
): Promise<ExtractionResult> {
  if (imageBytes.byteLength > MAX_VISION_IMAGE_BYTES) {
    return {
      extracted: null,
      provider: null,
      model: null,
      durationMs: 0,
      failureReason: `The image is too large for AI extraction (${(imageBytes.byteLength / 1024 / 1024).toFixed(1)} MB, limit ${MAX_VISION_IMAGE_BYTES / 1024 / 1024} MB). Upload a smaller photo or enter the details manually.`,
    };
  }

  const plan = planVisionExtraction(
    clients.map((client) => ({ provider: client.provider, visionModel: client.visionModel }))
  );
  if (!plan.ok) {
    return { extracted: null, provider: null, model: null, durationMs: 0, failureReason: plan.reason };
  }

  const capableProviders = new Set(plan.order.map((candidate) => candidate.provider));
  const visionClients = clients.filter((client) => capableProviders.has(client.provider));

  return extractWithFallback(
    visionClients,
    [
      { type: "image", mediaType, dataBase64: imageBytes.toString("base64") },
      { type: "text", text: "Extract the invoice data from this document image." },
    ],
    true
  );
}

/** Extracts invoice data from a document's text layer (any chat model). */
export async function extractInvoiceFromText(
  clients: AiClient[],
  text: string
): Promise<ExtractionResult> {
  if (clients.length === 0) {
    return {
      extracted: null,
      provider: null,
      model: null,
      durationMs: 0,
      failureReason:
        "No AI provider is configured. An administrator can set GROQ_API_KEY (free), OPENAI_API_KEY or ANTHROPIC_API_KEY to enable extraction.",
    };
  }
  return extractWithFallback(
    clients,
    `Extract the invoice data from this document text:\n\n${text.slice(0, 24_000)}`,
    false
  );
}
