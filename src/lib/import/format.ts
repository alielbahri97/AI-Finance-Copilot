import type { StatementFormat } from "./types";

interface FormatSpec {
  format: StatementFormat;
  label: string;
  extensions: readonly string[];
  mimeTypes: readonly string[];
}

const FORMATS: readonly FormatSpec[] = [
  {
    format: "csv",
    label: "CSV",
    extensions: [".csv", ".tsv", ".txt"],
    mimeTypes: ["text/csv", "text/tab-separated-values", "text/plain"],
  },
  {
    format: "excel",
    label: "Excel",
    extensions: [".xlsx", ".xlsm", ".xls"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
  },
  {
    format: "pdf",
    label: "PDF",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
  },
  {
    format: "mt940",
    label: "MT940",
    extensions: [".mt940", ".940", ".sta"],
    mimeTypes: [],
  },
];

export const STATEMENT_FORMAT_LABELS = Object.fromEntries(
  FORMATS.map((spec) => [spec.format, spec.label])
) as Record<StatementFormat, string>;

/** Every extension the importer accepts, lowercase and dot-prefixed. */
export const ACCEPTED_EXTENSIONS: readonly string[] = FORMATS.flatMap((spec) => spec.extensions);

/** Value for the file input's `accept` attribute. */
export const UPLOAD_ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_EXTENSIONS,
  ...FORMATS.flatMap((spec) => spec.mimeTypes),
].join(",");

/** "CSV, Excel, PDF or MT940" — for help text and error messages. */
export const ACCEPTED_FORMATS_SENTENCE = "CSV, Excel, PDF or MT940";

export function extensionOf(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

export function isSupportedStatementFile(fileName: string): boolean {
  return ACCEPTED_EXTENSIONS.includes(extensionOf(fileName));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** OLE2 compound file: legacy .xls and password-protected OOXML workbooks. */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

export function isOle2Container(bytes: Uint8Array): boolean {
  return startsWith(bytes, OLE2_SIGNATURE);
}

export function isZipContainer(bytes: Uint8Array): boolean {
  return startsWith(bytes, ZIP_SIGNATURE);
}

/** MT940 files are plain text built from `:NN:` tags, one statement per `:20:`. */
export function looksLikeMt940(text: string): boolean {
  return /(^|[\r\n]):61:/.test(text) && /(^|[\r\n]):(20|25|28C?):/.test(text);
}

/**
 * Picks the parser for an upload. Content wins over the file name — banks
 * routinely hand out `.xls` files that are really HTML tables and `.txt`
 * files that are really MT940 — but the extension decides when the bytes are
 * inconclusive, so a broken PDF still fails as a PDF instead of as a CSV.
 */
export function detectStatementFormat(fileName: string, bytes: Uint8Array): StatementFormat {
  const head = bytes.subarray(0, 4096);
  if (new TextDecoder("windows-1252").decode(head.subarray(0, 1024)).includes("%PDF-")) {
    return "pdf";
  }
  if (isZipContainer(bytes) || isOle2Container(bytes)) return "excel";
  if (looksLikeMt940(new TextDecoder("windows-1252").decode(head))) return "mt940";

  const extension = extensionOf(fileName);
  const spec = FORMATS.find((entry) => entry.extensions.includes(extension));
  return spec?.format ?? "csv";
}
