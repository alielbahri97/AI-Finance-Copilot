import { NextResponse } from "next/server";

import { detectStatementCurrency, suggestMapping } from "@/lib/csv/detect";
import { normalizeRows } from "@/lib/csv/normalize";
import { ACCEPTED_FORMATS_SENTENCE } from "@/lib/import/format";
import { parseStatement } from "@/lib/import/parse-statement";
import { StatementParseError } from "@/lib/import/types";
import {
  MAX_IMPORT_FILE_MB,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
} from "@/lib/validations/import";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { apiError } from "@/lib/api/response";
import { SUPPORTED_CURRENCIES } from "@/lib/validations/profile";
import { requireWorkspace } from "@/lib/workspace/context";

// Excel and PDF parsing need Node APIs, so this route must not run on edge.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Parses an uploaded statement (CSV, Excel, PDF or MT940) and returns the
 * detected structure, a suggested column mapping and a normalized preview.
 * Nothing is stored yet: the client re-sends the file together with the
 * (possibly corrected) mapping to /api/import/commit.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace("edit_transactions");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const limited = await enforceRateLimit("upload", user.id);
    if (limited) return limited;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: `Upload a ${ACCEPTED_FORMATS_SENTENCE} bank statement` },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "The file is empty" }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: `File is too large (max ${MAX_IMPORT_FILE_MB} MB)` },
        { status: 413 }
      );
    }

    let statement;
    try {
      statement = await parseStatement(file.name, await file.arrayBuffer());
    } catch (error) {
      if (error instanceof StatementParseError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
    if (statement.rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (max ${MAX_IMPORT_ROWS.toLocaleString()})` },
        { status: 413 }
      );
    }

    const mapping = suggestMapping(statement);
    const statementCurrency = detectStatementCurrency(statement, mapping);
    const importCurrency =
      statementCurrency.code &&
      (SUPPORTED_CURRENCIES as readonly string[]).includes(statementCurrency.code)
        ? statementCurrency.code
        : workspace.currency;
    const preview = normalizeRows(statement.rows.slice(0, 8), mapping, {
      expectedCurrency: statementCurrency.columnIndex !== null ? importCurrency : null,
    });

    return NextResponse.json({
      fileName: file.name,
      format: statement.format,
      source: statement.source,
      columnCount: statement.columnCount,
      rowCount: statement.rows.length,
      headers: statement.headers,
      sampleRows: statement.rows.slice(0, 8),
      mapping,
      preview: preview.ok,
      previewErrors: preview.errors,
      profileCurrency: workspace.currency,
      statementCurrency,
      currencyMismatch:
        statementCurrency.code !== null && statementCurrency.code !== workspace.currency,
    });
  } catch (error) {
    return apiError("POST /api/import/parse", "Could not parse the file", error);
  }
}
