import { looksLikeHeader } from "@/lib/csv/parse";

/**
 * Turns a ragged grid of cells (a spreadsheet, an HTML table, a reconstructed
 * PDF layout) into the header/rows shape the CSV pipeline expects: blank rows
 * and blank trailing columns dropped, leading title rows removed, every row
 * padded to the same width, header row detected with the CSV heuristic.
 */
export function buildGrid(input: string[][]): {
  headers: string[] | null;
  rows: string[][];
  columnCount: number;
} {
  const trimmed = input.map((row) => row.map((cell) => cell.trim()));
  const widths = trimmed.map((row) => {
    let width = 0;
    row.forEach((cell, index) => {
      if (cell !== "") width = index + 1;
    });
    return width;
  });

  const columnCount = Math.max(0, ...widths);
  if (columnCount === 0) return { headers: null, rows: [], columnCount: 0 };

  // Drop blank rows, and the single-cell title/caption rows many banks put
  // above the actual table.
  const body: string[][] = [];
  for (let index = 0; index < trimmed.length; index++) {
    if (widths[index] === 0) continue;
    if (body.length === 0 && columnCount > 1 && countFilled(trimmed[index]) < 2) continue;
    body.push(trimmed[index]);
  }
  if (body.length === 0) return { headers: null, rows: [], columnCount: 0 };

  const padded = body.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? "")
  );

  const [first, ...rest] = padded;
  if (looksLikeHeader(first, rest)) {
    return { headers: first, rows: rest, columnCount };
  }
  return { headers: null, rows: padded, columnCount };
}

function countFilled(row: string[]): number {
  return row.reduce((count, cell) => (cell === "" ? count : count + 1), 0);
}
