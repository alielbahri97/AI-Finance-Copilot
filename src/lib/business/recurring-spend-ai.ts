/**
 * The one thing in the recurring-spend audit that transactions cannot answer:
 * what job a vendor does. "Dropbox" and "Box" are two rows of identical shape
 * to a detector and obviously the same purchase to anyone who reads them, so
 * the model is asked for exactly one thing — a coarse category per vendor —
 * and never for an amount, a date or a judgement.
 *
 * Everything below the prompt is defensive for the usual reason: a label is
 * cheap to be wrong about, but a label the app trusts blindly can invent a
 * duplicate that costs someone a cancellation. So a category is only accepted
 * when it is short, lowercase-normalisable, not the vendor's own name, and
 * attached to an index that was actually sent.
 */

import { z } from "zod";

import { extractFirstJsonBlock } from "@/lib/ai/categorize-core";
import type { AiClient } from "@/lib/ai/types";
import { stripTrailingCommas } from "@/lib/invoices/extraction-core";
import { logger, serializeError } from "@/lib/logger";

/**
 * Vendors per request. Categorisation quality does not improve with a longer
 * list and index alignment starts to slip, the same reason transaction
 * categorization batches at 50.
 */
export const MAX_VENDORS_PER_BATCH = 25;

/**
 * Vendors labelled at all. Overlap only matters among the vendors big enough
 * to consolidate, and the list is already sorted dearest first, so a workspace
 * with 300 detected charges spends two requests rather than twelve.
 */
export const MAX_LABELLED_VENDORS = 50;

/** Longest accepted label. A category is two or three words; more is prose. */
const MAX_CATEGORY_LENGTH = 40;

export const TOOL_CATEGORY_SYSTEM_PROMPT = `You label recurring business vendors with the kind of service they provide, so that two vendors doing the same job can be spotted.

Reply with ONLY a JSON object (no markdown fences, no commentary) shaped exactly like this:
{
  "labels": [
    { "index": 0, "category": "cloud storage" }
  ]
}

Rules:
- "index" is the number shown next to the vendor. Never invent indexes.
- "category" is the job the vendor does, in two or three lowercase words: "cloud storage", "project management", "accounting", "payroll", "office rent", "payment processing", "email marketing", "code hosting", "telecoms", "insurance", "utilities".
- Use the SAME wording for vendors that do the same job. Consistency is the entire point: "task tracking" and "project management" for two comparable tools makes the answer useless.
- Never use the vendor's own name or a product name as the category.
- Omit any vendor whose purpose you do not recognise. A missing label is correct behaviour; a guess creates a false duplicate.
- You are labelling only. Never comment on the amounts, never suggest cancelling anything, never return any field other than the two above.`;

export interface LabellableVendor {
  /** Stable key the label is joined back onto. */
  key: string;
  label: string;
  /** The workspace's own accounting category, as a weak hint. */
  category: string;
}

/** The numbered vendor list. Amounts are deliberately not sent. */
export function buildToolCategoryPrompt(vendors: LabellableVendor[]): string {
  const lines = vendors
    .map(
      (vendor, index) =>
        `${index}. "${vendor.label.trim().slice(0, 120)}" (booked to: ${vendor.category.trim().slice(0, 60)})`
    )
    .join("\n");

  return `Vendors (index. name (the workspace's own accounting category)):
${lines}

Return the JSON object described in the system message.`;
}

const labelSchema = z.object({
  index: z.coerce.number().int().min(0),
  category: z.coerce.string().trim().min(3).max(MAX_CATEGORY_LENGTH),
});

const responseSchema = z.object({
  labels: z.array(labelSchema).max(200),
});

export type ToolCategoryLabel = z.infer<typeof labelSchema>;

export type ToolCategoryParseOutcome =
  | { ok: true; labels: ToolCategoryLabel[] }
  | { ok: false; error: string };

/** Accepts the documented shape, a bare array, and the usual key synonyms. */
function normalizeResponseShape(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return { labels: parsed };
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of ["labels", "categories", "vendors", "results"]) {
      if (Array.isArray(record[key])) return { labels: record[key] };
    }
  }
  return parsed;
}

/**
 * Parses model output into validated labels. Tolerates markdown fences,
 * leading prose and trailing commas, like every other JSON reply this app
 * accepts.
 */
export function parseToolCategoryOutput(raw: string): ToolCategoryParseOutcome {
  const candidate = extractFirstJsonBlock(raw);
  if (!candidate) return { ok: false, error: "No JSON object found in the response." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    try {
      parsed = JSON.parse(stripTrailingCommas(candidate));
    } catch (error) {
      return {
        ok: false,
        error: `The JSON is malformed: ${error instanceof Error ? error.message : "parse error"}.`,
      };
    }
  }

  const result = responseSchema.safeParse(normalizeResponseShape(parsed));
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `The labels failed validation — ${issues}.` };
  }
  return { ok: true, labels: result.data.labels };
}

/** Lowercased, single-spaced and stripped of the punctuation models add. */
export function normalizeToolCategory(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\s&/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CATEGORY_LENGTH);
}

/**
 * Joins labels back onto the batch they were asked about, dropping everything
 * questionable: an index that was never sent, a category that normalises away
 * to nothing, and the classic failure of echoing the vendor's own name back as
 * its category (which would put every vendor in a category of one and quietly
 * disable the overlap check).
 */
export function selectToolCategories(
  labels: ToolCategoryLabel[],
  vendors: LabellableVendor[]
): Map<string, string> {
  const selected = new Map<string, string>();

  for (const label of labels) {
    const vendor = vendors[label.index];
    if (!vendor) continue;
    if (selected.has(vendor.key)) continue;

    const category = normalizeToolCategory(label.category);
    if (category.length < 3) continue;
    if (normalizeToolCategory(vendor.label).includes(category)) continue;

    selected.set(vendor.key, category);
  }

  return selected;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Labels vendors in batches, returning vendor key → tool category.
 *
 * Never throws and never partially fails the page: a batch the model mangles
 * or the provider refuses is logged and skipped, and the audit simply shows no
 * overlap badges for those vendors. Callers that have no AI provider configured
 * should not call this at all — see the data layer's deterministic skip.
 */
export async function labelToolCategories(
  ai: AiClient,
  vendors: LabellableVendor[],
  options: { signal?: AbortSignal } = {}
): Promise<Map<string, string>> {
  const labelled = new Map<string, string>();
  const considered = vendors.slice(0, MAX_LABELLED_VENDORS);
  if (considered.length === 0) return labelled;

  for (const batch of chunk(considered, MAX_VENDORS_PER_BATCH)) {
    try {
      const raw = await ai.chat(
        [
          { role: "system", content: TOOL_CATEGORY_SYSTEM_PROMPT },
          { role: "user", content: buildToolCategoryPrompt(batch) },
        ],
        { temperature: 0, maxTokens: 800, jsonMode: true, signal: options.signal }
      );

      const parsed = parseToolCategoryOutput(raw);
      if (!parsed.ok) {
        logger.warn("[ai] vendor tool-category batch rejected", { error: parsed.error });
        continue;
      }
      for (const [key, category] of selectToolCategories(parsed.labels, batch)) {
        labelled.set(key, category);
      }
    } catch (error) {
      logger.warn("[ai] vendor tool-category batch failed", { error: serializeError(error) });
      break;
    }
  }

  return labelled;
}
