import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

/**
 * Supabase Storage helpers for invoice documents. The bucket is private;
 * files live under a per-user prefix (userId/invoiceId/filename) and are
 * served through short-lived signed URLs. See the README for the required
 * bucket + RLS policy setup.
 */

export const INVOICE_BUCKET = "invoices";
export const SIGNED_URL_TTL_SECONDS = 600;

export const INVOICE_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_INVOICE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Strips path separators and exotic characters from an uploaded filename. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const cleaned = base.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  return cleaned || "document";
}

export function invoiceStoragePath(userId: string, invoiceId: string, fileName: string): string {
  return `${userId}/${invoiceId}/${sanitizeFileName(fileName)}`;
}

export async function uploadInvoiceDocument(
  supabase: SupabaseClient,
  path: string,
  data: ArrayBuffer,
  contentType: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from(INVOICE_BUCKET).upload(path, data, {
    contentType,
    upsert: false,
  });
  if (!error) return { error: null };
  // Surface missing-bucket distinctly so API logs/responses can guide ops.
  const message = error.message ?? "unknown storage error";
  const storageCode = (error as { error?: string }).error ?? "";
  const missingBucket =
    /bucket not found/i.test(message) || storageCode === "Bucket not found";
  return {
    error: missingBucket
      ? `Bucket '${INVOICE_BUCKET}' not found. Create the private bucket and RLS policy (see README §5).`
      : message,
  };
}

export async function createInvoiceSignedUrl(
  supabase: SupabaseClient,
  path: string
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(INVOICE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    logger.error("failed to create signed URL", { detail: error?.message });
    return null;
  }
  return data.signedUrl;
}

export async function deleteInvoiceDocument(
  supabase: SupabaseClient,
  path: string
): Promise<void> {
  const { error } = await supabase.storage.from(INVOICE_BUCKET).remove([path]);
  if (error) {
    // The invoice row is being deleted anyway; log and continue.
    logger.error("failed to delete stored document", { detail: error.message });
  }
}
