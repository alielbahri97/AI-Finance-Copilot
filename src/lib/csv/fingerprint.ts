import { createHash } from "node:crypto";

import type { NormalizedRow } from "./types";

/**
 * Dedupe fingerprints for imported rows. Two identical rows in the same file
 * are legitimate (e.g. two identical card payments the same day), so each
 * repeat gets an occurrence index; re-importing the same file therefore maps
 * onto the same set of hashes, while distinct duplicates within a file are
 * preserved. Hashes are stored per user (unique [userId, hash]).
 */
export function fingerprintRows<T extends NormalizedRow>(rows: T[]): (T & { hash: string })[] {
  const occurrence = new Map<string, number>();
  return rows.map((row) => {
    const base = [
      row.date,
      row.type,
      row.amount.toFixed(2),
      row.description.toLowerCase(),
      (row.counterparty ?? "").toLowerCase(),
    ].join("|");
    const index = occurrence.get(base) ?? 0;
    occurrence.set(base, index + 1);
    return { ...row, hash: rowHash(`${base}|#${index}`) };
  });
}

function rowHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
