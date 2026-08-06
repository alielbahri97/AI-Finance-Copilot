import type { ParsedCsv } from "@/lib/csv/types";

/** Statement file formats the importer knows how to read. */
export type StatementFormat = "csv" | "excel" | "pdf" | "mt940";

/**
 * The intermediate representation every format funnels into: raw string cells
 * plus an optional header row — exactly what the CSV pipeline (column
 * detection, mapping, normalization, dedupe, commit) already consumes.
 */
export interface ParsedStatement extends ParsedCsv {
  format: StatementFormat;
  /** How the file was read, shown next to the file name in the mapping step. */
  source: string;
}

/**
 * A parse failure the user can act on (wrong format, unreadable file, empty
 * sheet, …). `status` is the HTTP status the API routes return, so every
 * format fails with its own message instead of a generic 500.
 */
export class StatementParseError extends Error {
  readonly status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = "StatementParseError";
    this.status = status;
  }
}
