import { describe, expect, it } from "vitest";

import {
  agreementFor,
  assessRequisition,
  computeDateFrom,
  consentState,
  isAccountRateLimited,
  mapBookedTransactions,
  pickBalance,
  rateLimitRetryAt,
  type GcBalance,
  type GcTransaction,
} from "@/lib/integrations/gocardless-core";

const ACCOUNT = "065da497-e6af-4950-88ed-2edbc0577d20";

/** Booked transactions exactly as in the GoCardless quickstart response. */
const QUICKSTART_BOOKED: GcTransaction[] = [
  {
    transactionId: "2020103000624289-1",
    debtorName: "MON MOTHMA",
    transactionAmount: { currency: "EUR", amount: "45.00" },
    bookingDate: "2020-10-30",
    valueDate: "2020-10-30",
    remittanceInformationUnstructured:
      "For the support of Restoration of the Republic foundation",
  },
  {
    transactionId: "2020111101899195-1",
    transactionAmount: { currency: "EUR", amount: "-15.00" },
    bookingDate: "2020-11-11",
    valueDate: "2020-11-11",
    remittanceInformationUnstructured: "PAYMENT Alderaan Coffe",
  },
];

describe("gocardless transaction mapping", () => {
  it("maps credits to INCOME and debits to EXPENSE with absolute amounts", () => {
    const mapped = mapBookedTransactions(ACCOUNT, QUICKSTART_BOOKED);
    expect(mapped).toHaveLength(2);

    expect(mapped[0]).toMatchObject({
      externalId: `${ACCOUNT}:2020103000624289-1`,
      date: "2020-10-30",
      type: "INCOME",
      amount: 45,
      counterparty: "MON MOTHMA",
    });
    expect(mapped[1]).toMatchObject({
      externalId: `${ACCOUNT}:2020111101899195-1`,
      date: "2020-11-11",
      type: "EXPENSE",
      amount: 15,
      description: "PAYMENT Alderaan Coffe",
    });
  });

  it("uses creditorName as counterparty for outgoing money", () => {
    const [tx] = mapBookedTransactions(ACCOUNT, [
      {
        transactionId: "t1",
        creditorName: "Alderaan Coffee Ltd",
        transactionAmount: { currency: "EUR", amount: "-4.50" },
        bookingDate: "2026-01-05",
      },
    ]);
    expect(tx.counterparty).toBe("Alderaan Coffee Ltd");
    expect(tx.type).toBe("EXPENSE");
  });

  it("joins remittanceInformationUnstructuredArray when the single field is missing", () => {
    const [tx] = mapBookedTransactions(ACCOUNT, [
      {
        transactionId: "t2",
        remittanceInformationUnstructuredArray: ["CARD PAYMENT", "REF 123"],
        transactionAmount: { currency: "GBP", amount: "-9.99" },
        bookingDate: "2026-01-06",
      },
    ]);
    expect(tx.description).toBe("CARD PAYMENT REF 123");
  });

  it("falls back to valueDate and skips zero/invalid amounts and dateless rows", () => {
    const mapped = mapBookedTransactions(ACCOUNT, [
      {
        transactionId: "value-date-only",
        transactionAmount: { currency: "EUR", amount: "-10.00" },
        valueDate: "2026-02-01",
      },
      { transactionId: "zero", transactionAmount: { currency: "EUR", amount: "0.00" }, bookingDate: "2026-02-01" },
      { transactionId: "bad", transactionAmount: { currency: "EUR", amount: "not-a-number" }, bookingDate: "2026-02-01" },
      { transactionId: "no-date", transactionAmount: { currency: "EUR", amount: "-5.00" } },
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].date).toBe("2026-02-01");
  });

  it("derives a stable fingerprint id when the bank sends no transaction ids", () => {
    const row: GcTransaction = {
      bookingDate: "2026-03-01",
      transactionAmount: { currency: "EUR", amount: "-12.34" },
      remittanceInformationUnstructured: "COFFEE",
    };
    const [a] = mapBookedTransactions(ACCOUNT, [row]);
    const [b] = mapBookedTransactions(ACCOUNT, [{ ...row }]);
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId.startsWith(`${ACCOUNT}:`)).toBe(true);

    const [c] = mapBookedTransactions(ACCOUNT, [
      { ...row, transactionAmount: { currency: "EUR", amount: "-12.35" } },
    ]);
    expect(c.externalId).not.toBe(a.externalId);
  });

  it("prefers entryReference over the hash fallback", () => {
    const [tx] = mapBookedTransactions(ACCOUNT, [
      {
        entryReference: "ER-778",
        bookingDate: "2026-03-02",
        transactionAmount: { currency: "EUR", amount: "-1.00" },
      },
    ]);
    expect(tx.externalId).toBe(`${ACCOUNT}:ER-778`);
  });
});

describe("gocardless balance selection", () => {
  const balance = (type: string, amount: string): GcBalance => ({
    balanceType: type,
    balanceAmount: { amount, currency: "EUR" },
  });

  it("prefers interimAvailable over expected and booked types", () => {
    const picked = pickBalance([
      balance("closingBooked", "100.00"),
      balance("interimAvailable", "88.50"),
      balance("expected", "95.00"),
    ]);
    expect(picked).toEqual({ amount: 88.5, currency: "EUR", type: "interimAvailable" });
  });

  it("falls back to expected when no available balance is present", () => {
    const picked = pickBalance([
      balance("closingBooked", "100.00"),
      balance("expected", "95.00"),
    ]);
    expect(picked?.type).toBe("expected");
  });

  it("tolerates unknown types and returns null for an empty or unusable list", () => {
    expect(pickBalance([])).toBeNull();
    expect(pickBalance([balance("weirdCustomType", "abc") as GcBalance])).toBeNull();
    const picked = pickBalance([balance("someBankSpecificType", "42.00")]);
    expect(picked?.amount).toBe(42);
  });
});

describe("gocardless requisition assessment", () => {
  it("accepts LN with accounts", () => {
    expect(assessRequisition("LN", 2).ok).toBe(true);
  });

  it("rejects LN without accounts", () => {
    const result = assessRequisition("LN", 0);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no accounts/i);
  });

  it("flags RJ as rejected with a friendly, retry-safe message", () => {
    const result = assessRequisition("RJ", 0);
    expect(result.kind).toBe("rejected");
    expect(result.message).toMatch(/no access was granted/i);
  });

  it("flags EX as expired", () => {
    expect(assessRequisition("EX", 0).kind).toBe("expired");
  });

  it("treats every intermediate stage as in-progress", () => {
    for (const status of ["CR", "GC", "UA", "SA", "GA"]) {
      expect(assessRequisition(status, 0).kind).toBe("in_progress");
    }
  });

  it("handles unknown statuses defensively", () => {
    expect(assessRequisition("??", 0).kind).toBe("unknown");
  });
});

describe("gocardless rate limiting", () => {
  const now = new Date("2026-08-04T10:00:00Z");

  it("reads the per-account success reset header (seconds)", () => {
    const headers = new Map([["x-ratelimit-account-success-reset", "3600"]]);
    const retryAt = rateLimitRetryAt((name) => headers.get(name) ?? null, now);
    expect(retryAt.toISOString()).toBe("2026-08-04T11:00:00.000Z");
  });

  it("falls back to the general reset header, then to 24h", () => {
    const general = new Map([["x-ratelimit-reset", "60"]]);
    expect(rateLimitRetryAt((n) => general.get(n) ?? null, now).toISOString()).toBe(
      "2026-08-04T10:01:00.000Z"
    );
    expect(rateLimitRetryAt(() => null, now).toISOString()).toBe("2026-08-05T10:00:00.000Z");
  });

  it("skips accounts whose recorded window has not passed, account-by-account", () => {
    const stored = {
      "acc-1": "2026-08-04T12:00:00Z",
      "acc-2": "2026-08-04T09:00:00Z",
    };
    expect(isAccountRateLimited(stored, "acc-1", now)).toBe(true);
    expect(isAccountRateLimited(stored, "acc-2", now)).toBe(false);
    expect(isAccountRateLimited(stored, "acc-3", now)).toBe(false);
    expect(isAccountRateLimited(undefined, "acc-1", now)).toBe(false);
  });
});

describe("gocardless sync window", () => {
  const now = new Date("2026-08-04T10:00:00Z");

  it("uses the agreed historical window on the first sync", () => {
    expect(computeDateFrom(null, 180, now)).toBe("2026-02-05");
    expect(computeDateFrom(null, null, now)).toBe("2026-05-06"); // 90-day default
  });

  it("uses a small overlap before the last sync afterwards", () => {
    expect(computeDateFrom("2026-08-01T00:00:00Z", 180, now)).toBe("2026-07-27");
  });
});

describe("gocardless consent lifecycle", () => {
  const now = new Date("2026-08-04T10:00:00Z");

  it("is unknown without an expiry (legacy connections)", () => {
    expect(consentState(null, now).state).toBe("unknown");
    expect(consentState("not-a-date", now).state).toBe("unknown");
  });

  it("is active well before expiry and expiring within the warning window", () => {
    expect(consentState("2026-11-01T00:00:00Z", now).state).toBe("active");
    const expiring = consentState("2026-08-14T10:00:00Z", now);
    expect(expiring.state).toBe("expiring");
    expect(expiring.daysLeft).toBe(10);
  });

  it("is expired after the date passes", () => {
    expect(consentState("2026-08-04T09:59:00Z", now).state).toBe("expired");
  });
});

describe("gocardless agreement sizing", () => {
  it("uses institution limits, capped at the API maximums", () => {
    expect(
      agreementFor({ id: "X", name: "X", transaction_total_days: "730", max_access_valid_for_days: "180" })
    ).toEqual({ maxHistoricalDays: 730, accessValidForDays: 180 });
    expect(
      agreementFor({ id: "X", name: "X", transaction_total_days: "900", max_access_valid_for_days: "365" })
    ).toEqual({ maxHistoricalDays: 730, accessValidForDays: 180 });
  });

  it("falls back to the 90-day defaults when the institution omits limits", () => {
    expect(agreementFor({ id: "X", name: "X" })).toEqual({
      maxHistoricalDays: 90,
      accessValidForDays: 90,
    });
  });
});
