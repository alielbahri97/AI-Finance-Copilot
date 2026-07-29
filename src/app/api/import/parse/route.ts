import { NextResponse } from "next/server";

import { detectStatementCurrency, suggestMapping } from "@/lib/csv/detect";
import { normalizeRows } from "@/lib/csv/normalize";
import { parseCsv } from "@/lib/csv/parse";
import { getOrCreateProfile } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS } from "@/lib/validations/import";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { apiError } from "@/lib/api/response";
import { SUPPORTED_CURRENCIES } from "@/lib/validations/profile";

export const maxDuration = 60;

/**
 * Parses an uploaded CSV and returns the detected structure, a suggested
 * column mapping and a normalized preview. Nothing is stored yet: the client
 * re-sends the file together with the (possibly corrected) mapping to
 * /api/import/commit.
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
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a CSV file" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "The file is empty" }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json({ error: "File is too large (max 8 MB)" }, { status: 413 });
    }

    const csv = parseCsv(await file.arrayBuffer());
    if (csv.rows.length === 0) {
      return NextResponse.json(
        { error: "No data rows found. Is this a valid CSV file?" },
        { status: 422 }
      );
    }
    if (csv.rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (max ${MAX_IMPORT_ROWS.toLocaleString()})` },
        { status: 413 }
      );
    }

    const profile = await getOrCreateProfile(user);
    const mapping = suggestMapping(csv);
    const statementCurrency = detectStatementCurrency(csv, mapping);
    const importCurrency =
      statementCurrency.code &&
      (SUPPORTED_CURRENCIES as readonly string[]).includes(statementCurrency.code)
        ? statementCurrency.code
        : profile.currency;
    const preview = normalizeRows(csv.rows.slice(0, 8), mapping, {
      expectedCurrency: statementCurrency.columnIndex !== null ? importCurrency : null,
    });

    return NextResponse.json({
      fileName: file.name,
      delimiter: csv.delimiter,
      columnCount: csv.columnCount,
      rowCount: csv.rows.length,
      headers: csv.headers,
      sampleRows: csv.rows.slice(0, 8),
      mapping,
      preview: preview.ok,
      previewErrors: preview.errors,
      profileCurrency: profile.currency,
      statementCurrency,
      currencyMismatch:
        statementCurrency.code !== null && statementCurrency.code !== profile.currency,
    });
  } catch (error) {
    return apiError("POST /api/import/parse", "Could not parse the file", error);
  }
}
