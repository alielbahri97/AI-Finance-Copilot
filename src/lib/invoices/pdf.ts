import "server-only";

import { logger, serializeError } from "@/lib/logger";

import { extractImages, extractText, getDocumentProxy } from "unpdf";

import { encodePng } from "./png";

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
    logger.error("PDF text extraction", { error: serializeError(error) });
    return null;
  }
}

/** True when the extracted text is too thin to be a usable text layer (scanned PDF). */
export function hasNoTextLayer(text: string | null): boolean {
  return !text || text.replace(/\s+/g, "").length < 40;
}

/** Skip thumbnails/logos; a scanned page is a large raster. */
const MIN_SCAN_DIMENSION = 400;
/** Cap decoded size so PNG encoding stays fast and the payload uploadable. */
const MAX_SCAN_PIXELS = 12_000_000;
const MAX_SCAN_PAGES = 3;

/**
 * For scanned PDFs (no text layer): pulls the largest embedded page image and
 * re-encodes it as PNG so vision extraction can read it. Pure JS — no page
 * rasterizer (that would need a native canvas); returns null when the PDF has
 * no usable embedded image.
 */
export async function getLargestPdfImage(buffer: ArrayBuffer): Promise<Buffer | null> {
  try {
    const document = await getDocumentProxy(new Uint8Array(buffer));
    const pages = Math.min(document.numPages, MAX_SCAN_PAGES);

    let best: { data: Uint8ClampedArray; width: number; height: number; channels: 1 | 3 | 4 } | null =
      null;
    for (let page = 1; page <= pages; page++) {
      const images = await extractImages(document, page);
      for (const image of images) {
        if (image.width < MIN_SCAN_DIMENSION || image.height < MIN_SCAN_DIMENSION) continue;
        if (image.width * image.height > MAX_SCAN_PIXELS) continue;
        if (!best || image.width * image.height > best.width * best.height) {
          best = image;
        }
      }
      // The first page's scan is almost always the invoice; stop once found.
      if (best) break;
    }

    if (!best) return null;
    return encodePng(best.data, best.width, best.height, best.channels);
  } catch (error) {
    logger.error("PDF embedded image extraction", { error: serializeError(error) });
    return null;
  }
}
