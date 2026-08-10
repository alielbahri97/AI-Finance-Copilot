import { describe, expect, it } from "vitest";

import { Decimal } from "@/generated/prisma/internal/prismaNamespace";
import {
  money,
  moneyAmount,
  moneyOrNull,
  MONEY_SCALE,
  timestamp,
  timestampOrNull,
} from "@/lib/api/wire";

/**
 * The wire contract is the one thing here that an Android release pins for
 * months, so it is tested as a contract rather than as an implementation:
 * these assertions are the promise, and changing one is a breaking change.
 */

describe("money on the wire", () => {
  it("is a string, never a JSON number", () => {
    expect(typeof money(12.34)).toBe("string");
    expect(JSON.parse(JSON.stringify({ amount: money(12.34) }))).toEqual({ amount: "12.34" });
  });

  it("always carries two decimal places, matching the stored scale", () => {
    expect(MONEY_SCALE).toBe(2);
    expect(money(0)).toBe("0.00");
    expect(money(5)).toBe("5.00");
    expect(money(5.1)).toBe("5.10");
    expect(money(-42)).toBe("-42.00");
  });

  it("formats a Prisma Decimal exactly, without going through a float", () => {
    // The value that makes the case: 1234567890.12 is representable, but a
    // running total of values like it in a double is not.
    expect(money(new Decimal("1234567890.12"))).toBe("1234567890.12");
    expect(money(new Decimal("0.1"))).toBe("0.10");
    expect(money(new Decimal("-0.005"))).toBe("-0.01");
    expect(money(new Decimal("99999999999.99"))).toBe("99999999999.99");
  });

  it("treats a missing amount as zero, and an absent one as null", () => {
    expect(money(null)).toBe("0.00");
    expect(money(undefined)).toBe("0.00");
    expect(moneyOrNull(null)).toBeNull();
    expect(moneyOrNull(undefined)).toBeNull();
    expect(moneyOrNull(new Decimal("3"))).toBe("3.00");
  });

  it("has one zero, not a positive and a negative one", () => {
    expect(money(-0)).toBe("0.00");
    expect(money(-0.001)).toBe("0.00");
    expect(money(new Decimal("-0.0001"))).toBe("0.00");
  });

  it("does not emit NaN or Infinity into JSON", () => {
    expect(money(Number.NaN)).toBe("0.00");
    expect(money(Number.POSITIVE_INFINITY)).toBe("0.00");
    expect(money("not a number")).toBe("0.00");
  });

  it("pairs an amount with its currency where the context does not imply one", () => {
    expect(moneyAmount(new Decimal("10.5"), "EUR")).toEqual({ amount: "10.50", currency: "EUR" });
  });

  it("round-trips into an exact decimal on the client side", () => {
    // What Kotlin's BigDecimal(String) does, modelled with the same library the
    // server stores in: no drift, unlike Number("0.1") + Number("0.2").
    const values = ["0.1", "0.2", "1234567890.12", "-0.03"];
    const total = values
      .map((raw) => new Decimal(money(new Decimal(raw))))
      .reduce((sum, value) => sum.plus(value), new Decimal(0));

    expect(total.toFixed(2)).toBe("1234567890.39");
  });
});

describe("timestamps on the wire", () => {
  it("are ISO 8601 in UTC with milliseconds and an explicit Z", () => {
    expect(timestamp(new Date(Date.UTC(2026, 7, 10, 12, 34, 56)))).toBe(
      "2026-08-10T12:34:56.000Z"
    );
    expect(timestamp(new Date("2026-08-10T12:34:56+02:00"))).toBe("2026-08-10T10:34:56.000Z");
  });

  it("send a calendar day as UTC midnight, so the first ten characters are the day", () => {
    const day = timestamp(new Date("2026-08-10T00:00:00.000Z"));

    expect(day).toBe("2026-08-10T00:00:00.000Z");
    expect(day.slice(0, 10)).toBe("2026-08-10");
  });

  it("distinguish absent from epoch", () => {
    expect(timestampOrNull(null)).toBeNull();
    expect(timestampOrNull(undefined)).toBeNull();
    expect(timestampOrNull(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
  });

  it("never emit the string \"Invalid Date\"", () => {
    expect(timestampOrNull("nonsense")).toBeNull();
  });
});
