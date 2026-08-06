import "server-only";

import { extractTextItems, getDocumentProxy } from "unpdf";
import type { StructuredTextItem } from "unpdf";

import { parsePdfStatementText } from "./pdf-core";
import { StatementParseError } from "./types";
import type { ParsedStatement } from "./types";

/** Below this much text a PDF is a scan, not a statement with a text layer. */
const MIN_TEXT_LAYER_CHARS = 40;

/** Two glyph runs closer than this on the same line belong to the same word. */
const WORD_GAP = 1.2;

function sameLine(a: StructuredTextItem, b: StructuredTextItem): boolean {
  const tolerance = Math.max(1.5, Math.min(a.fontSize, b.fontSize) * 0.4);
  return Math.abs(a.y - b.y) <= tolerance;
}

/**
 * Rebuilds visual lines from positioned glyph runs. PDF.js emits statement
 * columns as separate runs with no whitespace between them, so `hasEOL` alone
 * produces one long smear; grouping by baseline and inserting a space wherever
 * runs are set apart horizontally restores the printed layout.
 */
export function linesFromTextItems(items: StructuredTextItem[]): string[] {
  const usable = items.filter((item) => item.str.trim() !== "");
  if (usable.length === 0) return [];

  const sorted = [...usable].sort((a, b) => (b.y === a.y ? a.x - b.x : b.y - a.y));
  const lines: string[] = [];
  let current: StructuredTextItem[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const ordered = [...current].sort((a, b) => a.x - b.x);
    let text = "";
    let cursor = Number.NEGATIVE_INFINITY;
    for (const item of ordered) {
      if (text !== "" && item.x - cursor > WORD_GAP) text += " ";
      text += item.str;
      cursor = item.x + item.width;
    }
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed !== "") lines.push(trimmed);
    current = [];
  };

  for (const item of sorted) {
    if (current.length > 0 && !sameLine(current[current.length - 1], item)) flush();
    current.push(item);
  }
  flush();

  return lines;
}

function extractionError(error: unknown): StatementParseError {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") {
    return new StatementParseError(
      "This PDF is password-protected. Remove the password (open it and re-save without one) and upload it again.",
      422
    );
  }
  return new StatementParseError(
    "This file could not be opened as a PDF. It may be corrupt or only partially downloaded — try downloading the statement again.",
    422
  );
}

/**
 * Reads a bank statement PDF: text layer out, heuristic line parser in. The
 * result always goes through the normal preview step, so the user reviews and
 * corrects it before anything is committed.
 */
export async function parsePdfStatement(buffer: ArrayBuffer): Promise<ParsedStatement> {
  let pages: StructuredTextItem[][];
  try {
    const document = await getDocumentProxy(new Uint8Array(buffer.slice(0)));
    ({ items: pages } = await extractTextItems(document));
  } catch (error) {
    throw extractionError(error);
  }

  const lines = pages.flatMap((items) => linesFromTextItems(items));
  const density = lines.join("").replace(/\s+/g, "").length;
  if (density < MIN_TEXT_LAYER_CHARS) {
    throw new StatementParseError(
      "This PDF has no text layer — it looks like a scan or a photo of a statement. Download the statement again as a real PDF, or use your bank's CSV, Excel or MT940 export.",
      422
    );
  }

  return parsePdfStatementText(lines.join("\n"));
}
