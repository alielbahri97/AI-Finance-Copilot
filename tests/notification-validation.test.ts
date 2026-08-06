import { describe, expect, it } from "vitest";

import {
  markReadSchema,
  notificationPreferencesSchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
} from "@/lib/validations/notification";

/* ------------------------------------------------------------------ */
/* Preferences payload                                                 */
/* ------------------------------------------------------------------ */

describe("notificationPreferencesSchema", () => {
  it("accepts a single toggle, so the UI can patch one field", () => {
    expect(notificationPreferencesSchema.parse({ dailySummary: true })).toEqual({
      dailySummary: true,
    });
  });

  it("accepts the full payload the settings form sends", () => {
    const full = {
      dailySummary: true,
      weeklySummary: false,
      monthlySummary: true,
      largeTransaction: true,
      largeTransactionThreshold: 2500,
      lowCash: true,
      lowCashFloor: 250.5,
      lowCashHorizonDays: 45,
      invoiceReminders: false,
      channelInApp: true,
      channelEmail: true,
      channelPush: false,
    };
    expect(notificationPreferencesSchema.parse(full)).toEqual(full);
  });

  it("coerces the numeric fields from the strings an HTML input produces", () => {
    expect(
      notificationPreferencesSchema.parse({
        largeTransactionThreshold: "2500",
        lowCashFloor: "0",
        lowCashHorizonDays: "7",
      })
    ).toEqual({ largeTransactionThreshold: 2500, lowCashFloor: 0, lowCashHorizonDays: 7 });
  });

  it("rejects an empty patch", () => {
    const result = notificationPreferencesSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Nothing to update");
  });

  it("strips unknown keys, and rejects the payload when nothing known is left", () => {
    expect(notificationPreferencesSchema.safeParse({ isAdmin: true }).success).toBe(false);
    expect(notificationPreferencesSchema.parse({ lowCash: false, isAdmin: true })).toEqual({
      lowCash: false,
    });
  });

  it("rejects negative and absurd amounts", () => {
    for (const value of [-1, 1_000_000_001]) {
      expect(notificationPreferencesSchema.safeParse({ lowCashFloor: value }).success).toBe(false);
      expect(
        notificationPreferencesSchema.safeParse({ largeTransactionThreshold: value }).success
      ).toBe(false);
    }
  });

  it("rejects a horizon outside 1..365 and a fractional one", () => {
    for (const value of [0, -5, 366, 30.5]) {
      expect(notificationPreferencesSchema.safeParse({ lowCashHorizonDays: value }).success).toBe(
        false
      );
    }
    expect(notificationPreferencesSchema.safeParse({ lowCashHorizonDays: 365 }).success).toBe(true);
  });

  it("rejects an unparseable number rather than storing NaN", () => {
    expect(notificationPreferencesSchema.safeParse({ lowCashFloor: "abc" }).success).toBe(false);
    expect(notificationPreferencesSchema.safeParse({ lowCashFloor: {} }).success).toBe(false);
  });

  it("rejects a non-boolean toggle", () => {
    expect(notificationPreferencesSchema.safeParse({ channelEmail: "yes" }).success).toBe(false);
    expect(notificationPreferencesSchema.safeParse({ channelEmail: 1 }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Mark-read payload                                                   */
/* ------------------------------------------------------------------ */

describe("markReadSchema", () => {
  it("accepts a list of ids and accepts all: true", () => {
    expect(markReadSchema.parse({ ids: ["n1", "n2"] })).toEqual({ ids: ["n1", "n2"] });
    expect(markReadSchema.parse({ all: true })).toEqual({ all: true });
  });

  it("requires one of the two", () => {
    for (const body of [{}, { all: false }, { ids: [] }, { ids: [], all: false }]) {
      const result = markReadSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("Provide ids or all: true");
    }
  });

  it("rejects empty ids and non-string ids", () => {
    expect(markReadSchema.safeParse({ ids: [""] }).success).toBe(false);
    expect(markReadSchema.safeParse({ ids: [123] }).success).toBe(false);
  });

  it("caps the batch at 200 ids", () => {
    const ids = (count: number) => Array.from({ length: count }, (_, i) => `n${i}`);
    expect(markReadSchema.safeParse({ ids: ids(200) }).success).toBe(true);
    expect(markReadSchema.safeParse({ ids: ids(201) }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Push subscription payloads                                          */
/* ------------------------------------------------------------------ */

describe("push subscription schemas", () => {
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "BPu...", auth: "k3y" },
  };

  it("accepts what pushManager.subscribe().toJSON() produces", () => {
    expect(pushSubscriptionSchema.parse(subscription)).toEqual(subscription);
  });

  it("requires a real URL endpoint and both keys", () => {
    expect(pushSubscriptionSchema.safeParse({ ...subscription, endpoint: "abc" }).success).toBe(
      false
    );
    expect(
      pushSubscriptionSchema.safeParse({ ...subscription, keys: { p256dh: "", auth: "k" } }).success
    ).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: subscription.endpoint }).success).toBe(
      false
    );
  });

  it("bounds the endpoint and the key lengths", () => {
    expect(
      pushSubscriptionSchema.safeParse({
        ...subscription,
        endpoint: `https://example.com/${"x".repeat(1000)}`,
      }).success
    ).toBe(false);
    expect(
      pushSubscriptionSchema.safeParse({
        ...subscription,
        keys: { p256dh: "x".repeat(501), auth: "k" },
      }).success
    ).toBe(false);
  });

  it("takes just the endpoint to unsubscribe", () => {
    expect(pushUnsubscribeSchema.parse({ endpoint: subscription.endpoint })).toEqual({
      endpoint: subscription.endpoint,
    });
    expect(pushUnsubscribeSchema.safeParse({ endpoint: "" }).success).toBe(false);
  });
});
