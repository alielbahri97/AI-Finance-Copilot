import { NextResponse } from "next/server";

import { trackEvent } from "@/lib/analytics";
import { checkLimit, getEntitlements, incrementUsage } from "@/lib/billing/entitlements";
import { getOrCreateProfile } from "@/lib/data";
import { ingestInvoiceDocument } from "@/lib/invoices/ingest";
import { INVOICE_MIME_TYPES, MAX_INVOICE_FILE_BYTES } from "@/lib/invoices/storage";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { apiError } from "@/lib/api/response";
import { logger, serializeError } from "@/lib/logger";
import { requireWorkspace } from "@/lib/workspace/context";

export const maxDuration = 120;

/**
 * Accepts an invoice document (PDF or image), stores it in the private
 * Supabase Storage bucket, runs AI extraction and creates a DRAFT invoice
 * for the user to review. Extraction failures degrade to manual entry with
 * the document still attached (extractionStatus = NEEDS_REVIEW).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace("edit_invoices");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const limited = await enforceRateLimit("upload", user.id);
    if (limited) return limited;

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { error: "The upload request was malformed. Try again from the upload dialog." },
        { status: 400 }
      );
    }
    const file = formData.get("file");
    const direction = formData.get("direction") === "RECEIVABLE" ? "RECEIVABLE" : "PAYABLE";
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Attach a file to upload" }, { status: 400 });
    }
    if (!(file.type in INVOICE_MIME_TYPES)) {
      const isHeic =
        /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      return NextResponse.json(
        {
          error: isHeic
            ? "HEIC photos (iPhone default) are not supported. In the share sheet choose JPEG, or convert the photo to JPG/PNG, then upload again."
            : `"${file.type || file.name}" is not a supported format. Upload a PDF, JPG, PNG or WebP document.`,
        },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "The file is empty (0 bytes). Re-export or re-scan the document and try again." },
        { status: 400 }
      );
    }
    if (file.size > MAX_INVOICE_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the maximum is ${MAX_INVOICE_FILE_BYTES / 1024 / 1024} MB. Compress the PDF or downscale the photo and try again.`,
        },
        { status: 400 }
      );
    }

    const profile = await getOrCreateProfile(user);

    // Plan gating: AI extraction has a monthly quota. Over-quota uploads
    // still work — they just skip extraction and go to manual review.
    const entitlements = await getEntitlements(workspace.id);
    const extractionQuota = checkLimit(
      entitlements,
      "invoiceExtractions",
      entitlements.plan.limits.invoiceExtractionsPerMonth
    );
    if (extractionQuota.allowed) {
      await incrementUsage(workspace.id, "invoiceExtractions");
    }

    let result;
    try {
      result = await ingestInvoiceDocument({
        workspaceId: workspace.id,
        userId: user.id,
        currency: workspace.currency,
        aiProvider: profile.aiProvider,
        buffer: await file.arrayBuffer(),
        mimeType: file.type,
        fileName: file.name,
        direction,
        storage: await createClient(),
        attemptExtraction: extractionQuota.allowed,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const missingBucket = /bucket .* not found|Bucket 'invoices' not found/i.test(detail);
      logger.error("Invoice upload to storage", {
        error: serializeError(error),
        missingBucket,
      });
      return NextResponse.json(
        {
          error: missingBucket
            ? "Could not store the document: the private 'invoices' storage bucket is missing in Supabase. Create it and the per-user RLS policy (see README §5)."
            : "Could not store the document. Make sure the private 'invoices' bucket and its policies exist in Supabase (see README).",
        },
        { status: 502 }
      );
    }

    await trackEvent(user.id, "invoice_upload", {
      extracted: result.extracted,
      extractionSkipped: !extractionQuota.allowed,
    });

    return NextResponse.json(
      {
        invoiceId: result.invoiceId,
        extractionStatus: result.extractionStatus,
        extractionSkipped: !extractionQuota.allowed,
        reviewReason: result.reviewReason,
      },
      { status: 201 }
    );
  } catch (error) {
    return apiError("POST /api/invoices/upload", "Failed to upload the invoice", error);
  }
}
