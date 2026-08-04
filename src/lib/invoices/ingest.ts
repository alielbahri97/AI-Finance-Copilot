import "server-only";

import { logger, serializeError } from "@/lib/logger";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAiClients, providerFromProfile } from "@/lib/ai";
import { resolveInvoiceCurrency } from "@/lib/currency/parse";
import {
  extractInvoiceFromImage,
  extractInvoiceFromText,
  type ExtractionResult,
} from "@/lib/invoices/extraction";
import {
  lowConfidenceFields,
  validateArithmetic,
  type ExtractedInvoice,
} from "@/lib/invoices/extraction-core";
import { getLargestPdfImage, getPdfText, hasNoTextLayer } from "@/lib/invoices/pdf";
import {
  invoiceStoragePath,
  sanitizeFileName,
  uploadInvoiceDocument,
} from "@/lib/invoices/storage";
import { prisma } from "@/lib/prisma";

/**
 * Shared invoice ingestion: stores the document, runs AI extraction and
 * creates a DRAFT invoice for review. Used by the upload route (user session)
 * and by the Gmail/Outlook integrations (service-role storage client).
 */

export interface IngestInvoiceInput {
  workspaceId: string;
  /** The member who uploaded the document (also namespaces the storage path). */
  userId: string;
  currency: string;
  aiProvider: "OPENAI" | "ANTHROPIC" | "GROQ";
  buffer: ArrayBuffer;
  mimeType: string;
  fileName: string;
  direction: "PAYABLE" | "RECEIVABLE";
  /** Stable source id for dedupe (e.g. "gmail:<messageId>:<attachmentId>"). */
  externalRef?: string;
  /** Storage client: user-scoped for uploads, service-role for background sync. */
  storage: SupabaseClient;
  attemptExtraction: boolean;
}

export interface IngestInvoiceResult {
  invoiceId: string;
  extractionStatus: "EXTRACTED" | "NEEDS_REVIEW";
  extracted: boolean;
  /** Why the document needs review (extraction failure or arithmetic warnings). */
  reviewReason: string | null;
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

const EMPTY_RESULT: ExtractionResult = {
  extracted: null,
  provider: null,
  model: null,
  durationMs: 0,
  failureReason: null,
};

/** Runs the right extraction path for the document type. */
async function extractDocument(
  input: IngestInvoiceInput
): Promise<{ result: ExtractionResult; documentText: string | null }> {
  const clients = getAiClients(providerFromProfile(input.aiProvider));

  if (input.mimeType !== "application/pdf") {
    const result = await extractInvoiceFromImage(
      clients,
      input.mimeType,
      Buffer.from(input.buffer)
    );
    return { result, documentText: null };
  }

  const text = await getPdfText(input.buffer);
  if (!hasNoTextLayer(text)) {
    const result = await extractInvoiceFromText(clients, text as string);
    return { result, documentText: text };
  }

  // Scanned PDF: no text layer. Try the embedded page image with vision.
  const pageImage = await getLargestPdfImage(input.buffer);
  if (pageImage) {
    const result = await extractInvoiceFromImage(clients, "image/png", pageImage);
    return {
      result:
        result.failureReason === null
          ? result
          : { ...result, failureReason: `This PDF looks scanned (no selectable text). ${result.failureReason}` },
      documentText: text,
    };
  }

  return {
    result: {
      ...EMPTY_RESULT,
      failureReason:
        text === null
          ? "The PDF could not be parsed — it may be corrupted or password-protected. Enter the details manually."
          : "This PDF looks scanned: it has no selectable text and no embedded page image we could read. Enter the details manually.",
    },
    documentText: text,
  };
}

export async function ingestInvoiceDocument(
  input: IngestInvoiceInput
): Promise<IngestInvoiceResult> {
  // Store the original document first so a failed extraction still leaves
  // the file attached to the draft invoice.
  const invoiceId = randomUUID();
  const storagePath = invoiceStoragePath(input.userId, invoiceId, input.fileName);
  const { error: uploadError } = await uploadInvoiceDocument(
    input.storage,
    storagePath,
    input.buffer,
    input.mimeType
  );
  if (uploadError) {
    throw new Error(`Could not store the document: ${uploadError}`);
  }

  // Extraction: vision for images (and scanned PDFs), text layer for PDFs.
  // Never throws the upload away — failures degrade to review with a reason.
  let extraction: ExtractionResult = EMPTY_RESULT;
  let documentText: string | null = null;
  if (input.attemptExtraction) {
    try {
      const outcome = await extractDocument(input);
      extraction = outcome.result;
      documentText = outcome.documentText;
    } catch (error) {
      logger.error("Invoice extraction", { error: serializeError(error) });
      extraction = {
        ...EMPTY_RESULT,
        failureReason: `Extraction failed unexpectedly: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
  }

  const extracted: ExtractedInvoice | null = extraction.extracted;

  // Cross-check the arithmetic; mismatches flag the invoice for review
  // instead of silently saving wrong numbers.
  const warnings = extracted ? validateArithmetic(extracted) : [];
  const lowConfidence = extracted ? lowConfidenceFields(extracted) : [];

  const reviewReason = !input.attemptExtraction
    ? null
    : extracted
      ? warnings.length > 0
        ? `Extracted, but the numbers don't add up: ${warnings[0]}`
        : null
      : (extraction.failureReason ?? "Extraction produced no data.");

  // Prefer currency printed on the document; fall back to the profile currency.
  const currency = resolveInvoiceCurrency({
    extracted: extracted?.currency,
    documentText: documentText ?? input.fileName,
    fallback: input.currency,
  });

  const lineItems = (extracted?.lineItems ?? []).map((item, index) => {
    const quantity = item.quantity ?? 1;
    const unitPrice = item.unitPrice ?? 0;
    return {
      description: item.description,
      quantity,
      unitPrice,
      total: item.total ?? Math.round(quantity * unitPrice * 100) / 100,
      sortOrder: index,
    };
  });

  const invoice = await prisma.invoice.create({
    data: {
      id: invoiceId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      vendor: extracted?.vendor ?? "",
      invoiceNumber: extracted?.invoiceNumber ?? null,
      invoiceDate: toDate(extracted?.invoiceDate),
      dueDate: toDate(extracted?.dueDate),
      currency,
      subtotal: extracted?.subtotal ?? null,
      vatAmount: extracted?.vatAmount ?? null,
      vatRate: extracted?.vatRate ?? null,
      total: extracted?.total ?? lineItems.reduce((sum, item) => sum + item.total, 0),
      direction: input.direction,
      status: "DRAFT",
      extractionStatus: extracted && warnings.length === 0 ? "EXTRACTED" : "NEEDS_REVIEW",
      extractionProvider: extraction.provider,
      extractionModel: extraction.model,
      extractionDurationMs: extraction.durationMs || null,
      extractionReason: reviewReason,
      extractionWarnings: warnings.length > 0 ? warnings : undefined,
      extractionConfidence:
        extracted?.confidence && Object.keys(extracted.confidence).length > 0
          ? extracted.confidence
          : undefined,
      storagePath,
      fileName: sanitizeFileName(input.fileName),
      mimeType: input.mimeType,
      externalRef: input.externalRef ?? null,
      lineItems: { create: lineItems },
    },
    select: { id: true, extractionStatus: true },
  });

  if (lowConfidence.length > 0) {
    logger.info("invoice extraction low-confidence fields", {
      invoiceId: invoice.id,
      fields: lowConfidence,
    });
  }

  return {
    invoiceId: invoice.id,
    extractionStatus: invoice.extractionStatus as "EXTRACTED" | "NEEDS_REVIEW",
    extracted: Boolean(extracted),
    reviewReason,
  };
}
