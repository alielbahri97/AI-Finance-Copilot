import { NextResponse } from "next/server";

import { suggestMapping } from "@/lib/csv/detect";
import { normalizeRows } from "@/lib/csv/normalize";
import { parseCsv } from "@/lib/csv/parse";
import { getUser } from "@/lib/supabase/server";
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS } from "@/lib/validations/import";

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

    const mapping = suggestMapping(csv);
    const preview = normalizeRows(csv.rows.slice(0, 8), mapping);

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
    });
  } catch (error) {
    console.error("POST /api/import/parse failed:", error);
    return NextResponse.json({ error: "Could not parse the file" }, { status: 500 });
  }
}
