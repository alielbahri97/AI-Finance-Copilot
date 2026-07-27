import { describe, expect, it } from "vitest";

import { fingerprintRows } from "@/lib/csv/fingerprint";
import type { NormalizedRow } from "@/lib/csv/types";

function row(overrides: Partial<NormalizedRow> = {}): NormalizedRow {
  return {
    date: "2026-07-15",
    description: "Coffee shop",
    counterparty: "Starbucks",
    amount: 4.5,
    type: "EXPENSE",
    balance: null,
    ...overrides,
  };
}

describe("import dedupe fingerprints", () => {
  it("gives identical rows in the same file distinct hashes (occurrence index)", () => {
    const [a, b] = fingerprintRows([row(), row()]);
    expect(a.hash).not.toBe(b.hash);
  });

  it("is stable across re-imports of the same file", () => {
    const first = fingerprintRows([row(), row({ description: "Rent" }), row()]);
    const second = fingerprintRows([row(), row({ description: "Rent" }), row()]);
    expect(first.map((r) => r.hash)).toEqual(second.map((r) => r.hash));
  });

  it("is case-insensitive on description and counterparty", () => {
    const [a] = fingerprintRows([row({ description: "COFFEE SHOP", counterparty: "STARBUCKS" })]);
    const [b] = fingerprintRows([row({ description: "coffee shop", counterparty: "starbucks" })]);
    expect(a.hash).toBe(b.hash);
  });

  it("differs when any identity field differs", () => {
    const base = fingerprintRows([row()])[0].hash;
    expect(fingerprintRows([row({ amount: 4.51 })])[0].hash).not.toBe(base);
    expect(fingerprintRows([row({ date: "2026-07-16" })])[0].hash).not.toBe(base);
    expect(fingerprintRows([row({ type: "INCOME" })])[0].hash).not.toBe(base);
    expect(fingerprintRows([row({ counterparty: null })])[0].hash).not.toBe(base);
  });

  it("does not include the balance in the fingerprint", () => {
    const [a] = fingerprintRows([row({ balance: 100 })]);
    const [b] = fingerprintRows([row({ balance: 200 })]);
    expect(a.hash).toBe(b.hash);
  });
});
