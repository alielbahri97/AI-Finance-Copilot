import "server-only";

import { ingestInvoiceDocument } from "@/lib/invoices/ingest";
import { MAX_INVOICE_FILE_BYTES } from "@/lib/invoices/storage";
import { prisma } from "@/lib/prisma";
import { createServiceClient } from "@/lib/supabase/service";

import { IntegrationAuthError, IntegrationError } from "../oauth";

import type { ProviderHooks, SyncContext, SyncStats } from "./types";

/**
 * Gmail: searches the mailbox for recent messages with PDF attachments that
 * look like invoices and feeds them through the shared invoice ingestion
 * pipeline (Supabase Storage + AI extraction + review queue).
 */

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SEARCH_QUERY =
  "has:attachment filename:pdf (invoice OR receipt OR bill OR factuur OR rechnung) newer_than:60d";
/** Bound the AI extraction cost of a single sync run. */
const MAX_INGEST_PER_RUN = 5;

async function gmailGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${GMAIL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationAuthError("Gmail token rejected; reconnect required");
  }
  if (!response.ok) {
    throw new IntegrationError(`Gmail ${path} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

function collectPdfParts(part: GmailPart, into: GmailPart[]): void {
  if (
    part.mimeType === "application/pdf" &&
    part.filename &&
    part.body?.attachmentId
  ) {
    into.push(part);
  }
  for (const child of part.parts ?? []) {
    collectPdfParts(child, into);
  }
}

function base64UrlToBuffer(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function sync(ctx: SyncContext): Promise<SyncStats> {
  if (!ctx.accessToken) {
    throw new IntegrationAuthError("Gmail connection has no access token");
  }
  const storage = createServiceClient();
  if (!storage) {
    throw new IntegrationError(
      "SUPABASE_SERVICE_ROLE_KEY is required for mailbox invoice ingestion"
    );
  }

  const search = await gmailGet<{ messages?: { id: string }[] }>(
    `/messages?q=${encodeURIComponent(SEARCH_QUERY)}&maxResults=25`,
    ctx.accessToken
  );
  const messageIds = (search.messages ?? []).map((message) => message.id);

  let scanned = 0;
  let ingested = 0;
  let skipped = 0;

  for (const messageId of messageIds) {
    if (ingested >= MAX_INGEST_PER_RUN) break;
    scanned += 1;

    const message = await gmailGet<{ payload?: GmailPart }>(
      `/messages/${messageId}?format=full`,
      ctx.accessToken
    );
    const pdfParts: GmailPart[] = [];
    if (message.payload) collectPdfParts(message.payload, pdfParts);

    for (const part of pdfParts) {
      if (ingested >= MAX_INGEST_PER_RUN) break;
      const attachmentId = part.body?.attachmentId as string;
      const externalRef = `gmail:${messageId}:${attachmentId.slice(0, 60)}`;

      const already = await prisma.invoice.findFirst({
        where: { userId: ctx.userId, externalRef },
        select: { id: true },
      });
      if (already) {
        skipped += 1;
        continue;
      }

      const attachment = await gmailGet<{ data?: string; size?: number }>(
        `/messages/${messageId}/attachments/${attachmentId}`,
        ctx.accessToken
      );
      if (!attachment.data) continue;
      const buffer = base64UrlToBuffer(attachment.data);
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_INVOICE_FILE_BYTES) {
        skipped += 1;
        continue;
      }

      await ingestInvoiceDocument({
        userId: ctx.userId,
        currency: ctx.currency,
        aiProvider: ctx.aiProvider,
        buffer: buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer,
        mimeType: "application/pdf",
        fileName: part.filename || "invoice.pdf",
        direction: "PAYABLE",
        externalRef,
        storage,
        attemptExtraction: true,
      });
      ingested += 1;
    }
  }

  return { scanned, ingested, skipped };
}

export const gmailHooks: ProviderHooks = { sync };
