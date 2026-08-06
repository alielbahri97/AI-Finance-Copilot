/** Shared RFC-4180 CSV helpers used by every export surface. */

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLines(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** UTF-8 BOM so Excel opens the file with the right encoding. */
export function withBom(csv: string): string {
  return `\uFEFF${csv}`;
}
