import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { getAiClient } from "@/lib/ai";
import { getOrCreateProfile } from "@/lib/data";
import {
  extractFromImage,
  extractFromText,
  type ExtractedInvoice,
} from "@/lib/invoices/extraction";
import { getPdfText, hasNoTextLayer } from "@/lib/invoices/pdf";
import {
  INVOICE_MIME_TYPES,
  MAX_INVOICE_FILE_BYTES,
  invoiceStoragePath,
  sanitizeFileName,
  uploadInvoiceDocument,
} from "@/lib/invoices/storage";
import { prisma } from "@/lib/prisma";
import { createClient, getUser } from "@/lib/supabase/server";

export const maxDuration = 120;

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

/**
 * Accepts an invoice document (PDF or image), stores it in the private
 * Supabase Storage bucket, runs AI extraction and creates a DRAFT invoice
 * for the user to review. Extraction failures degrade to manual entry with
 * the document still attached (extractionStatus = NEEDS_REVIEW).
 */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    const direction = formData?.get("direction") === "RECEIVABLE" ? "RECEIVABLE" : "PAYABLE";
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Attach a file to upload" }, { status: 400 });
    }
    if (!(file.type in INVOICE_MIME_TYPES)) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a PDF, JPG, PNG or WebP document." },
        { status: 400 }
      );
    }
    if (file.size === 0 || file.size > MAX_INVOICE_FILE_BYTES) {
      return NextResponse.json(
        { error: "The file must be between 1 byte and 10 MB." },
        { status: 400 }
      );
    }

    const profile = await getOrCreateProfile(user);
    const buffer = await file.arrayBuffer();

    // Store the original document first so a failed extraction still leaves
    // the file attached to the draft invoice.
    const invoiceId = randomUUID();
    const storagePath = invoiceStoragePath(user.id, invoiceId, file.name);
    const supabase = await createClient();
    const { error: uploadError } = await uploadInvoiceDocument(
      supabase,
      storagePath,
      buffer,
      file.type
    );
    if (uploadError) {
      console.error("Invoice upload to storage failed:", uploadError);
      return NextResponse.json(
        {
          error:
            "Could not store the document. Make sure the private 'invoices' bucket and its policies exist in Supabase (see README).",
        },
        { status: 502 }
      );
    }

    // Extraction: vision for images, text layer for PDFs. Any failure — no
    // text layer, invalid AI output, provider errors — falls back to review.
    let extracted: ExtractedInvoice | null = null;
    try {
      const ai = getAiClient(profile.aiProvider === "ANTHROPIC" ? "anthropic" : "openai");
      if (file.type === "application/pdf") {
        const text = await getPdfText(buffer);
        if (!hasNoTextLayer(text)) {
          extracted = await extractFromText(ai, text as string);
        }
      } else {
        extracted = await extractFromImage(ai, file.type, Buffer.from(buffer).toString("base64"));
      }
    } catch (error) {
      console.error("Invoice extraction failed:", error);
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
        userId: user.id,
        vendor: extracted?.vendor ?? "",
        invoiceNumber: extracted?.invoiceNumber ?? null,
        invoiceDate: toDate(extracted?.invoiceDate),
        dueDate: toDate(extracted?.dueDate),
        currency: extracted?.currency ?? profile.currency,
        subtotal: extracted?.subtotal ?? null,
        vatAmount: extracted?.vatAmount ?? null,
        vatRate: extracted?.vatRate ?? null,
        total: extracted?.total ?? lineItems.reduce((sum, item) => sum + item.total, 0),
        direction,
        status: "DRAFT",
        extractionStatus: extracted ? "EXTRACTED" : "NEEDS_REVIEW",
        storagePath,
        fileName: sanitizeFileName(file.name),
        mimeType: file.type,
        lineItems: { create: lineItems },
      },
      select: { id: true, extractionStatus: true },
    });

    return NextResponse.json(
      { invoiceId: invoice.id, extractionStatus: invoice.extractionStatus },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/invoices/upload failed:", error);
    return NextResponse.json({ error: "Failed to upload the invoice" }, { status: 500 });
  }
}
