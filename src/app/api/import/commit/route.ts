import { NextResponse } from "next/server";

import { trackEvent } from "@/lib/analytics";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { apiError } from "@/lib/api/response";
import {
  checkLimit,
  getEntitlements,
  incrementUsage,
  limitError,
} from "@/lib/billing/entitlements";
import { loadRuleMatchers, matchCategory } from "@/lib/categories";
import { fingerprintRows } from "@/lib/csv/fingerprint";
import { normalizeRows } from "@/lib/csv/normalize";
import { parseCsv } from "@/lib/csv/parse";
import { getOrCreateProfile } from "@/lib/data";
import { evaluateLargeTransactions } from "@/lib/notifications/alerts";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import {
  columnMappingSchema,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
} from "@/lib/validations/import";

export const maxDuration = 60;

/**
 * Imports a CSV using the confirmed column mapping. Rows already imported in
 * a previous batch (same fingerprint) are skipped; the whole import is stored
 * as an ImportBatch so it can be undone in one click.
 */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await enforceRateLimit("upload", user.id);
    if (limited) return limited;

    const formData = await request.formData();
    const file = formData.get("file");
    const mappingRaw = formData.get("mapping");
    if (!(file instanceof File) || typeof mappingRaw !== "string") {
      return NextResponse.json({ error: "Missing file or mapping" }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json({ error: "File is too large (max 8 MB)" }, { status: 413 });
    }

    let mappingJson: unknown;
    try {
      mappingJson = JSON.parse(mappingRaw);
    } catch {
      return NextResponse.json({ error: "Invalid mapping" }, { status: 400 });
    }
    const mappingParsed = columnMappingSchema.safeParse(mappingJson);
    if (!mappingParsed.success) {
      return NextResponse.json(
        { error: "Invalid column mapping", issues: mappingParsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const mapping = mappingParsed.data;

    // Plan gating: monthly import quota and per-import row cap.
    const entitlements = await getEntitlements(user.id);
    const quota = checkLimit(entitlements, "csvImports", entitlements.plan.limits.csvImportsPerMonth);
    if (!quota.allowed) {
      return NextResponse.json(limitError("CSV import", entitlements.planId), { status: 402 });
    }

    const csv = parseCsv(await file.arrayBuffer());
    if (csv.rows.length === 0) {
      return NextResponse.json({ error: "No data rows found" }, { status: 422 });
    }
    if (csv.rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (max ${MAX_IMPORT_ROWS.toLocaleString()})` },
        { status: 413 }
      );
    }
    const rowCap = entitlements.plan.limits.rowsPerImport;
    if (rowCap !== null && csv.rows.length > rowCap) {
      return NextResponse.json(
        {
          error: `This file has ${csv.rows.length.toLocaleString()} rows, but the ${entitlements.plan.name} plan allows ${rowCap.toLocaleString()} per import. Upgrade on the Billing page for larger imports.`,
          code: "LIMIT_REACHED",
          feature: "rows per import",
          plan: entitlements.planId,
        },
        { status: 402 }
      );
    }
    const columnIndexes = [
      mapping.date,
      mapping.description,
      mapping.amount,
      mapping.debit,
      mapping.credit,
      mapping.balance,
      mapping.counterparty,
    ].filter((index): index is number => index !== null);
    if (columnIndexes.some((index) => index >= csv.columnCount)) {
      return NextResponse.json(
        { error: "Mapping refers to columns that do not exist in this file" },
        { status: 400 }
      );
    }

    const profile = await getOrCreateProfile(user);

    const { ok: rows, errors } = normalizeRows(csv.rows, mapping);
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: "No rows could be interpreted with this mapping",
          rowErrors: errors.slice(0, 10),
        },
        { status: 422 }
      );
    }

    const withHashes = fingerprintRows(rows);

    const existing = await prisma.transaction.findMany({
      where: { userId: user.id, hash: { in: withHashes.map((row) => row.hash) } },
      select: { hash: true },
    });
    const existingHashes = new Set(existing.map((row) => row.hash));
    const fresh = withHashes.filter((row) => !existingHashes.has(row.hash));
    const duplicates = withHashes.length - fresh.length;

    if (fresh.length === 0) {
      return NextResponse.json({
        imported: 0,
        duplicates,
        failed: errors.length,
        rowErrors: errors.slice(0, 10),
        batchId: null,
      });
    }

    const matchers = await loadRuleMatchers(user.id);

    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: { userId: user.id, fileName: file.name.slice(0, 200) },
      });
      await tx.transaction.createMany({
        data: fresh.map((row) => ({
          userId: user.id,
          type: row.type,
          amount: row.amount,
          categoryId: matchCategory(matchers, row.description, row.counterparty),
          description: row.description,
          counterparty: row.counterparty,
          date: new Date(`${row.date}T00:00:00.000Z`),
          balance: row.balance,
          hash: row.hash,
          importBatchId: created.id,
        })),
      });
      return created;
    });

    await incrementUsage(user.id, "csvImports");
    await trackEvent(user.id, "import", { rows: fresh.length, batchId: batch.id });

    // Immediate large-transaction alerts for the imported rows (aggregated
    // into one notification when several qualify); never fails the import.
    await evaluateLargeTransactions(
      user.id,
      profile.currency,
      fresh.map((row) => ({
        type: row.type,
        amount: row.amount,
        description: row.description,
        counterparty: row.counterparty,
        date: new Date(`${row.date}T00:00:00.000Z`),
      }))
    );

    return NextResponse.json({
      imported: fresh.length,
      duplicates,
      failed: errors.length,
      rowErrors: errors.slice(0, 10),
      batchId: batch.id,
    });
  } catch (error) {
    return apiError("POST /api/import/commit", "Import failed", error);
  }
}
