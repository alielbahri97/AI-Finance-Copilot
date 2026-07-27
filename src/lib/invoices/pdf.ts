import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

/**
 * Extracts the text layer of a PDF using unpdf (pure JS, works in Next.js
 * server routes). Returns null when the PDF cannot be parsed at all.
 */
export async function getPdfText(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const document = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(document, { mergePages: true });
    return text;
  } catch (error) {
    console.error("PDF text extraction failed:", error);
    return null;
  }
}

/** True when the extracted text is too thin to be a usable text layer (scanned PDF). */
export function hasNoTextLayer(text: string | null): boolean {
  return !text || text.replace(/\s+/g, "").length < 40;
}
