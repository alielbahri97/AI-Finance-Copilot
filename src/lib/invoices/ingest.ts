import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAiClient } from "@/lib/ai";
import {
  extractFromImage,
  extractFromText,
  type ExtractedInvoice,
} from "@/lib/invoices/extraction";
import { getPdfText, hasNoTextLayer } from "@/lib/invoices/pdf";
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
  userId: string;
  currency: string;
  aiProvider: "OPENAI" | "ANTHROPIC";
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
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
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

  // Extraction: vision for images, text layer for PDFs. Any failure — no
  // text layer, invalid AI output, provider errors — falls back to review.
  let extracted: ExtractedInvoice | null = null;
  if (input.attemptExtraction) {
    try {
      const ai = getAiClient(input.aiProvider === "ANTHROPIC" ? "anthropic" : "openai");
      if (input.mimeType === "application/pdf") {
        const text = await getPdfText(input.buffer);
        if (!hasNoTextLayer(text)) {
          extracted = await extractFromText(ai, text as string);
        }
      } else {
        extracted = await extractFromImage(
          ai,
          input.mimeType,
          Buffer.from(input.buffer).toString("base64")
        );
      }
    } catch (error) {
      console.error("Invoice extraction failed:", error);
    }
  }

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
      userId: input.userId,
      vendor: extracted?.vendor ?? "",
      invoiceNumber: extracted?.invoiceNumber ?? null,
      invoiceDate: toDate(extracted?.invoiceDate),
      dueDate: toDate(extracted?.dueDate),
      currency: extracted?.currency ?? input.currency,
      subtotal: extracted?.subtotal ?? null,
      vatAmount: extracted?.vatAmount ?? null,
      vatRate: extracted?.vatRate ?? null,
      total: extracted?.total ?? lineItems.reduce((sum, item) => sum + item.total, 0),
      direction: input.direction,
      status: "DRAFT",
      extractionStatus: extracted ? "EXTRACTED" : "NEEDS_REVIEW",
      storagePath,
      fileName: sanitizeFileName(input.fileName),
      mimeType: input.mimeType,
      externalRef: input.externalRef ?? null,
      lineItems: { create: lineItems },
    },
    select: { id: true, extractionStatus: true },
  });

  return {
    invoiceId: invoice.id,
    extractionStatus: invoice.extractionStatus as "EXTRACTED" | "NEEDS_REVIEW",
    extracted: Boolean(extracted),
  };
}
