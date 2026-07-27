import "server-only";

import { ingestInvoiceDocument } from "@/lib/invoices/ingest";
import { MAX_INVOICE_FILE_BYTES } from "@/lib/invoices/storage";
import { prisma } from "@/lib/prisma";
import { createServiceClient } from "@/lib/supabase/service";

import { IntegrationAuthError, IntegrationError } from "../oauth";

import type { ProviderHooks, SyncContext, SyncStats } from "./types";

/**
 * Outlook (Microsoft Graph): finds recent messages with attachments, keeps
 * PDF attachments whose name or subject looks invoice-like, and pushes them
 * through the shared invoice ingestion pipeline.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const INVOICE_HINT = /invoice|receipt|bill|factuur|rechnung|facture/i;
const MAX_INGEST_PER_RUN = 5;

async function graphGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationAuthError("Microsoft Graph token rejected; reconnect required");
  }
  if (!response.ok) {
    throw new IntegrationError(`Microsoft Graph ${path} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

interface GraphMessage {
  id: string;
  subject?: string;
}

interface GraphAttachment {
  "@odata.type": string;
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  contentBytes?: string;
}

async function sync(ctx: SyncContext): Promise<SyncStats> {
  if (!ctx.accessToken) {
    throw new IntegrationAuthError("Outlook connection has no access token");
  }
  const storage = createServiceClient();
  if (!storage) {
    throw new IntegrationError(
      "SUPABASE_SERVICE_ROLE_KEY is required for mailbox invoice ingestion"
    );
  }

  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const filter = encodeURIComponent(
    `hasAttachments eq true and receivedDateTime ge ${since}`
  );
  const list = await graphGet<{ value: GraphMessage[] }>(
    `/me/messages?$filter=${filter}&$select=id,subject&$top=25&$orderby=receivedDateTime desc`,
    ctx.accessToken
  );

  let scanned = 0;
  let ingested = 0;
  let skipped = 0;

  for (const message of list.value) {
    if (ingested >= MAX_INGEST_PER_RUN) break;
    scanned += 1;
    const subjectLooksRelevant = INVOICE_HINT.test(message.subject ?? "");

    const attachments = await graphGet<{ value: GraphAttachment[] }>(
      `/me/messages/${message.id}/attachments`,
      ctx.accessToken
    );

    for (const attachment of attachments.value) {
      if (ingested >= MAX_INGEST_PER_RUN) break;
      const isPdf =
        attachment["@odata.type"] === "#microsoft.graph.fileAttachment" &&
        (attachment.contentType === "application/pdf" ||
          (attachment.name ?? "").toLowerCase().endsWith(".pdf"));
      if (!isPdf || !attachment.contentBytes) continue;
      if (!subjectLooksRelevant && !INVOICE_HINT.test(attachment.name ?? "")) continue;

      const externalRef = `outlook:${message.id.slice(0, 60)}:${attachment.id.slice(0, 60)}`;
      const already = await prisma.invoice.findFirst({
        where: { userId: ctx.userId, externalRef },
        select: { id: true },
      });
      if (already) {
        skipped += 1;
        continue;
      }

      const buffer = Buffer.from(attachment.contentBytes, "base64");
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
        fileName: attachment.name || "invoice.pdf",
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

export const outlookHooks: ProviderHooks = { sync };
