import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planSourceToWire, resolvePlanSource } from "@/lib/api/serializers/billing";
import type { Subscription } from "@/generated/prisma/client";
import {
  checkPlayIdentity,
  obfuscatedAccountId,
  obfuscatedProfileId,
  playIdentity,
} from "@/lib/billing/play/identity";
import {
  classifyDeveloperNotification,
  notificationPackageMatches,
  parsePubsubEnvelope,
} from "@/lib/billing/play/notifications";
import {
  planForPlayProduct,
  playManagementUrl,
  playProductAllowedForEdition,
  playProductForPlan,
  playProductsForEdition,
  PLAY_PRODUCTS,
} from "@/lib/billing/play/products";
import {
  PLAY_NOTIFICATION,
  PLAY_STATE,
  playEntitlement,
  playNotificationName,
  playNotificationRevokes,
  readPlayPurchase,
  type PlaySubscriptionPurchaseV2,
} from "@/lib/billing/play/state";
import { checkoutPlans } from "@/lib/billing/plans";
import {
  hasEntitlingStripeSubscription,
  isHigherTier,
  resolveEntitlement,
  tierRank,
  type PlayCandidateInput,
} from "@/lib/billing/resolution";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const HOUR = 3_600_000;

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1",
    workspaceId: "ws-1",
    userId: "user-1",
    plan: "FREE",
    status: "ACTIVE",
    planSource: "FREE",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    stripePlan: null,
    stripeStatus: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** A Stripe-paid workspace, written the way the webhook writes one. */
function stripePaid(plan: Subscription["plan"], status: Subscription["status"] = "ACTIVE") {
  return subscription({
    plan,
    status,
    planSource: "STRIPE",
    stripePlan: plan,
    stripeStatus: status,
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_stripe_1",
    currentPeriodEnd: new Date(NOW.getTime() + 30 * 24 * HOUR),
  });
}

function playCandidate(overrides: Partial<PlayCandidateInput> = {}): PlayCandidateInput {
  return {
    planId: "PRO",
    entitling: true,
    status: "ACTIVE",
    cancelAtPeriodEnd: false,
    accessUntil: new Date(NOW.getTime() + 20 * 24 * HOUR),
    ...overrides,
  };
}

function purchase(overrides: Partial<PlaySubscriptionPurchaseV2> = {}): PlaySubscriptionPurchaseV2 {
  return {
    subscriptionState: PLAY_STATE.active,
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    startTime: "2026-08-01T00:00:00.000Z",
    latestOrderId: "GPA.1234-5678",
    externalAccountIdentifiers: {
      obfuscatedExternalAccountId: obfuscatedAccountId("user-1"),
      obfuscatedExternalProfileId: obfuscatedProfileId("ws-1"),
    },
    lineItems: [
      {
        productId: "business_pro",
        expiryTime: "2026-09-01T00:00:00.000Z",
        autoRenewingPlan: { autoRenewEnabled: true },
        offerDetails: { basePlanId: "business-pro-monthly" },
      },
    ],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* The product catalogue                                              */
/* ------------------------------------------------------------------ */

describe("the Play product catalogue", () => {
  it("sells exactly the four self-serve tiers, one product each", () => {
    expect(PLAY_PRODUCTS.map((product) => product.productId)).toEqual([
      "business_pro",
      "business_team",
      "personal_plus",
      "personal_premium",
    ]);
  });

  it("has no product for contact-sales Enterprise, which has no price to charge", () => {
    expect(PLAY_PRODUCTS.some((product) => product.planId === "ENTERPRISE")).toBe(false);
    expect(playProductForPlan("ENTERPRISE", "business")).toBeNull();
  });

  // The whole point of the edition filter: a personal workspace being offered a
  // €49 business plan is a charge that can never be honoured.
  it("offers each edition exactly the tiers checkoutPlans offers", () => {
    for (const edition of ["business", "personal"] as const) {
      expect(playProductsForEdition(edition).map((product) => product.planId)).toEqual([
        ...checkoutPlans(edition),
      ]);
    }
  });

  it("refuses a business product for a personal workspace and the reverse", () => {
    expect(playProductAllowedForEdition("business_pro", "personal")).toBe(false);
    expect(playProductAllowedForEdition("personal_plus", "business")).toBe(false);
    expect(playProductAllowedForEdition("personal_plus", "personal")).toBe(true);
  });

  it("maps a product id onto a tier, and an unknown id onto nothing", () => {
    expect(planForPlayProduct("personal_premium")).toBe("PREMIUM");
    expect(planForPlayProduct("business_team")).toBe("BUSINESS");
    expect(planForPlayProduct("enterprise_unlimited")).toBeNull();
  });

  it("builds the Play deep link a client uses to manage a subscription", () => {
    expect(playManagementUrl("personal_plus", "com.ballastmoney.app")).toBe(
      "https://play.google.com/store/account/subscriptions?sku=personal_plus&package=com.ballastmoney.app"
    );
  });
});

/* ------------------------------------------------------------------ */
/* Obfuscated identifiers                                             */
/* ------------------------------------------------------------------ */

describe("the obfuscated identifiers that tie a purchase to a workspace", () => {
  it("hashes the user id and the workspace id to Play's 64-character limit", () => {
    const identity = playIdentity("user-1", "ws-1");
    expect(identity.obfuscatedAccountId).toBe(
      createHash("sha256").update("user-1").digest("hex")
    );
    expect(identity.obfuscatedProfileId).toBe(createHash("sha256").update("ws-1").digest("hex"));
    expect(identity.obfuscatedAccountId).toHaveLength(64);
    expect(identity.obfuscatedProfileId).toHaveLength(64);
  });

  it("gives two workspaces of the same user different profile ids", () => {
    expect(obfuscatedProfileId("ws-1")).not.toBe(obfuscatedProfileId("ws-2"));
    expect(playIdentity("user-1", "ws-1").obfuscatedAccountId).toBe(
      playIdentity("user-1", "ws-2").obfuscatedAccountId
    );
  });

  it("accepts a purchase whose identifiers match the caller", () => {
    expect(checkPlayIdentity(purchase().externalAccountIdentifiers, playIdentity("user-1", "ws-1")))
      .toBeNull();
  });

  it("rejects a purchase made by another user", () => {
    expect(
      checkPlayIdentity(purchase().externalAccountIdentifiers, playIdentity("user-2", "ws-1"))
    ).toBe("account");
  });

  // The two-workspace case: same Google account, same person, wrong workspace.
  it("rejects a purchase made for another workspace", () => {
    expect(
      checkPlayIdentity(purchase().externalAccountIdentifiers, playIdentity("user-1", "ws-2"))
    ).toBe("profile");
  });

  it("rejects a purchase with no identifiers at all", () => {
    expect(checkPlayIdentity(null, playIdentity("user-1", "ws-1"))).toBe("missing");
    expect(checkPlayIdentity({}, playIdentity("user-1", "ws-1"))).toBe("missing");
    expect(
      checkPlayIdentity(
        { obfuscatedExternalAccountId: obfuscatedAccountId("user-1") },
        playIdentity("user-1", "ws-1")
      )
    ).toBe("missing");
  });
});

/* ------------------------------------------------------------------ */
/* Reading a purchase                                                 */
/* ------------------------------------------------------------------ */

describe("reading a subscriptionsv2 payload", () => {
  it("flattens the fields the app stores", () => {
    const facts = readPlayPurchase(purchase());
    expect(facts).toMatchObject({
      productId: "business_pro",
      basePlanId: "business-pro-monthly",
      plan: "PRO",
      state: PLAY_STATE.active,
      autoRenewing: true,
      acknowledged: false,
      latestOrderId: "GPA.1234-5678",
      linkedPurchaseToken: null,
    });
    expect(facts.expiryTime?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("reports acknowledgement from Google's own state", () => {
    expect(
      readPlayPurchase(purchase({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" }))
        .acknowledged
    ).toBe(true);
  });

  it("treats a missing autoRenewingPlan as not renewing rather than guessing", () => {
    const facts = readPlayPurchase(
      purchase({ lineItems: [{ productId: "business_pro", expiryTime: null }] })
    );
    expect(facts.autoRenewing).toBe(false);
    expect(facts.expiryTime).toBeNull();
  });

  it("survives an empty payload without throwing", () => {
    const facts = readPlayPurchase({});
    expect(facts.productId).toBeNull();
    expect(facts.plan).toBeNull();
    expect(facts.state).toBe(PLAY_STATE.unspecified);
  });
});

/* ------------------------------------------------------------------ */
/* State to entitlement                                               */
/* ------------------------------------------------------------------ */

describe("what each Play state means for access", () => {
  const future = new Date(NOW.getTime() + 10 * 24 * HOUR);
  const past = new Date(NOW.getTime() - 10 * 24 * HOUR);

  it("entitles an active subscription", () => {
    expect(playEntitlement({ state: PLAY_STATE.active, expiryTime: future, now: NOW })).toMatchObject(
      { entitling: true, status: "ACTIVE", cancelAtPeriodEnd: false, terminal: false }
    );
  });

  // Grace period: the renewal payment failed and Google is retrying. Locking a
  // customer out of a finance app because their card expired turns a recoverable
  // payment problem into a cancellation.
  it("KEEPS access during the grace period", () => {
    const result = playEntitlement({
      state: PLAY_STATE.inGracePeriod,
      expiryTime: future,
      now: NOW,
    });
    expect(result.entitling).toBe(true);
    expect(result.status).toBe("PAST_DUE");
    expect(result.terminal).toBe(false);
  });

  // Account hold: the retries ran out. Access stops, but the subscription can
  // still recover if the payment method is fixed, so it is not terminal.
  it("CUTS access on account hold, without retiring the subscription", () => {
    const result = playEntitlement({ state: PLAY_STATE.onHold, expiryTime: future, now: NOW });
    expect(result.entitling).toBe(false);
    expect(result.status).toBe("INCOMPLETE");
    expect(result.terminal).toBe(false);
    expect(result.accessUntil).toBeNull();
  });

  it("never confuses the grace period with account hold", () => {
    const grace = playEntitlement({ state: PLAY_STATE.inGracePeriod, expiryTime: future, now: NOW });
    const hold = playEntitlement({ state: PLAY_STATE.onHold, expiryTime: future, now: NOW });
    expect(grace.entitling).toBe(true);
    expect(hold.entitling).toBe(false);
    expect(grace.status).not.toBe(hold.status);
  });

  it("keeps a cancelled subscription until its period ends, then stops", () => {
    const inPeriod = playEntitlement({ state: PLAY_STATE.canceled, expiryTime: future, now: NOW });
    expect(inPeriod).toMatchObject({
      entitling: true,
      status: "ACTIVE",
      cancelAtPeriodEnd: true,
      terminal: false,
    });

    const lapsed = playEntitlement({ state: PLAY_STATE.canceled, expiryTime: past, now: NOW });
    expect(lapsed).toMatchObject({ entitling: false, status: "CANCELED", terminal: true });
  });

  it("cuts access immediately on a revocation, whatever the period says", () => {
    const result = playEntitlement({
      state: PLAY_STATE.active,
      expiryTime: future,
      revoked: true,
      now: NOW,
    });
    expect(result).toMatchObject({
      entitling: false,
      status: "CANCELED",
      cancelAtPeriodEnd: false,
      accessUntil: null,
      terminal: true,
    });
  });

  it("cuts access while paused, and while a purchase is still pending payment", () => {
    expect(playEntitlement({ state: PLAY_STATE.paused, expiryTime: future, now: NOW }).entitling)
      .toBe(false);
    expect(playEntitlement({ state: PLAY_STATE.pending, expiryTime: null, now: NOW })).toMatchObject(
      { entitling: false, status: "INCOMPLETE" }
    );
  });

  it("retires an expired or cancelled-before-payment subscription", () => {
    for (const state of [PLAY_STATE.expired, PLAY_STATE.pendingPurchaseCanceled]) {
      const result = playEntitlement({ state, expiryTime: past, now: NOW });
      expect(result.entitling).toBe(false);
      expect(result.terminal).toBe(true);
    }
  });

  it("grants nothing for a state this build has never heard of", () => {
    const result = playEntitlement({
      state: "SUBSCRIPTION_STATE_SOMETHING_GOOGLE_ADDED_LATER",
      expiryTime: future,
      now: NOW,
    });
    expect(result.entitling).toBe(false);
    expect(result.terminal).toBe(false);
  });

  it("does not entitle an active subscription whose expiry has passed", () => {
    expect(playEntitlement({ state: PLAY_STATE.active, expiryTime: past, now: NOW }).entitling).toBe(
      false
    );
  });
});

/* ------------------------------------------------------------------ */
/* Notification classification                                        */
/* ------------------------------------------------------------------ */

describe("classifying a developer notification", () => {
  function envelope(notification: unknown) {
    return {
      message: {
        data: Buffer.from(JSON.stringify(notification)).toString("base64"),
        messageId: "9876543210",
        publishTime: "2026-08-10T12:00:00.000Z",
      },
      subscription: "projects/ballast/subscriptions/play-rtdn",
    };
  }

  it("unwraps the base64 payload out of the Pub/Sub envelope", () => {
    const parsed = parsePubsubEnvelope(
      envelope({
        version: "1.0",
        packageName: "com.ballastmoney.app",
        subscriptionNotification: {
          notificationType: PLAY_NOTIFICATION.renewed,
          purchaseToken: "token-1",
          subscriptionId: "business_pro",
        },
      })
    );
    expect(parsed?.messageId).toBe("9876543210");
    expect(parsed?.notification.packageName).toBe("com.ballastmoney.app");
  });

  it("rejects a malformed envelope rather than guessing at it", () => {
    expect(parsePubsubEnvelope(null)).toBeNull();
    expect(parsePubsubEnvelope({})).toBeNull();
    expect(parsePubsubEnvelope({ message: {} })).toBeNull();
    expect(parsePubsubEnvelope({ message: { data: "not base64 json" } })).toBeNull();
  });

  it("recognises every subscription lifecycle type", () => {
    const types = [
      PLAY_NOTIFICATION.recovered,
      PLAY_NOTIFICATION.renewed,
      PLAY_NOTIFICATION.canceled,
      PLAY_NOTIFICATION.purchased,
      PLAY_NOTIFICATION.onHold,
      PLAY_NOTIFICATION.inGracePeriod,
      PLAY_NOTIFICATION.restarted,
      PLAY_NOTIFICATION.priceChangeConfirmed,
      PLAY_NOTIFICATION.deferred,
      PLAY_NOTIFICATION.paused,
      PLAY_NOTIFICATION.pauseScheduleChanged,
      PLAY_NOTIFICATION.revoked,
      PLAY_NOTIFICATION.expired,
      PLAY_NOTIFICATION.pendingPurchaseCanceled,
    ];
    for (const notificationType of types) {
      const classified = classifyDeveloperNotification({
        subscriptionNotification: { notificationType, purchaseToken: "token-1" },
      });
      expect(classified.kind).toBe("subscription");
      if (classified.kind !== "subscription") continue;
      expect(classified.notificationType).toBe(notificationType);
      // Only a revocation is a refund; everything else keeps its period.
      expect(classified.revoked).toBe(notificationType === PLAY_NOTIFICATION.revoked);
    }
  });

  it("treats a voided subscription purchase as a revocation", () => {
    const classified = classifyDeveloperNotification({
      voidedPurchaseNotification: {
        purchaseToken: "token-1",
        orderId: "GPA.1",
        productType: 2,
        refundType: 1,
      },
    });
    expect(classified).toEqual({ kind: "voided", purchaseToken: "token-1", refundType: 1 });
  });

  it("ignores a voided one-time purchase, which cannot be one of ours", () => {
    expect(
      classifyDeveloperNotification({
        voidedPurchaseNotification: { purchaseToken: "token-1", productType: 1 },
      })
    ).toEqual({ kind: "ignored", reason: "voided_one_time_product" });
  });

  it("recognises the Play Console test notification", () => {
    expect(classifyDeveloperNotification({ testNotification: { version: "1.0" } })).toEqual({
      kind: "test",
    });
  });

  it("ignores a payload with nothing it understands", () => {
    expect(classifyDeveloperNotification({}).kind).toBe("ignored");
    expect(classifyDeveloperNotification({ subscriptionNotification: {} }).kind).toBe("ignored");
  });

  it("names notification types for the audit log", () => {
    expect(playNotificationName(PLAY_NOTIFICATION.inGracePeriod)).toBe(
      "SUBSCRIPTION_IN_GRACE_PERIOD"
    );
    expect(playNotificationName(PLAY_NOTIFICATION.onHold)).toBe("SUBSCRIPTION_ON_HOLD");
    expect(playNotificationName(99)).toContain("99");
  });

  it("only calls a revocation a revocation", () => {
    expect(playNotificationRevokes(PLAY_NOTIFICATION.revoked)).toBe(true);
    expect(playNotificationRevokes(PLAY_NOTIFICATION.canceled)).toBe(false);
    expect(playNotificationRevokes(PLAY_NOTIFICATION.expired)).toBe(false);
  });

  it("spots a notification for a different application", () => {
    const notification = { packageName: "com.someone.else" };
    expect(notificationPackageMatches(notification, "com.ballastmoney.app")).toBe(false);
    expect(notificationPackageMatches(notification, null)).toBe(true);
    expect(notificationPackageMatches({}, "com.ballastmoney.app")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Tier rank                                                          */
/* ------------------------------------------------------------------ */

describe("tier rank", () => {
  it("ranks each edition's ladder in order", () => {
    expect(
      ["FREE", "PRO", "BUSINESS", "ENTERPRISE"].map((plan) =>
        tierRank(plan as Subscription["plan"], "business")
      )
    ).toEqual([0, 1, 2, 3]);
    expect(
      ["FREE", "PLUS", "PREMIUM"].map((plan) => tierRank(plan as Subscription["plan"], "personal"))
    ).toEqual([0, 1, 2]);
  });

  it("still ranks a tier the edition does not sell, rather than throwing", () => {
    expect(tierRank("PREMIUM", "business")).toBe(2);
    expect(isHigherTier("PREMIUM", "PLUS", "business")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Resolution across payers                                           */
/* ------------------------------------------------------------------ */

describe("resolving a plan across Stripe, Play, a grant and a trial", () => {
  it("takes the higher tier when Play beats Stripe", () => {
    const resolved = resolveEntitlement({
      subscription: stripePaid("PRO"),
      play: [playCandidate({ planId: "BUSINESS" })],
      overridePlanId: null,
      edition: "business",
      now: NOW,
    });
    expect(resolved.planId).toBe("BUSINESS");
    expect(resolved.source).toBe("GOOGLE_PLAY");
    expect(resolved.candidates).toHaveLength(2);
  });

  it("takes the higher tier when Stripe beats Play", () => {
    const resolved = resolveEntitlement({
      subscription: stripePaid("BUSINESS"),
      play: [playCandidate({ planId: "PRO" })],
      overridePlanId: null,
      edition: "business",
      now: NOW,
    });
    expect(resolved.planId).toBe("BUSINESS");
    expect(resolved.source).toBe("STRIPE");
  });

  // The out-of-order webhook. Stripe and Google retry independently and neither
  // knows about the other, so a stale Play event about last month's expiry can
  // land after a web upgrade. Rank-based resolution cannot downgrade on it.
  it("does not downgrade a Stripe customer when a stale Play expiry arrives afterwards", () => {
    const resolved = resolveEntitlement({
      subscription: stripePaid("BUSINESS"),
      play: [playCandidate({ planId: "PRO", entitling: false, status: "CANCELED" })],
      overridePlanId: null,
      edition: "business",
      now: NOW,
    });
    expect(resolved.planId).toBe("BUSINESS");
    expect(resolved.source).toBe("STRIPE");
  });

  it("does not downgrade a Play customer when a stale Stripe cancellation arrives afterwards", () => {
    const resolved = resolveEntitlement({
      subscription: stripePaid("PRO", "CANCELED"),
      play: [playCandidate({ planId: "BUSINESS" })],
      overridePlanId: null,
      edition: "business",
      now: NOW,
    });
    expect(resolved.planId).toBe("BUSINESS");
    expect(resolved.source).toBe("GOOGLE_PLAY");
  });

  it("keeps Play access through the grace period", () => {
    const resolved = resolveEntitlement({
      subscription: subscription(),
      play: [playCandidate({ status: "PAST_DUE" })],
      overridePlanId: null,
      edition: "business",
      now: NOW,
    });
    expect(resolved.planId).toBe("PRO");
    expect(resolved.status).toBe("PAST_DUE");
  });

  it("falls back to the local trial when a Play subscription goes on hold", () => {
    const resolved = resolveEntitlement({
      subscription: subscription({ trialEndsAt: new Date(NOW.getTime() + 5 * 24 * HOUR) }),
      play: [playCandidate({ entitling: false, status: "INCOMPLETE" })],
      overridePlanId: null,
      edition: "business",
      now: NOW,
    });
    expect(resolved).toMatchObject({ planId: "PRO", source: "TRIAL", isTrial: true });
  });

  it("falls back to Free when nothing entitles and the trial is over", () => {
    const resolved = resolveEntitlement({
      subscription: subscription({ trialEndsAt: new Date(NOW.getTime() - HOUR) }),
      play: [playCandidate({ entitling: false, status: "CANCELED" })],
      overridePlanId: null,
      edition: "business",
      now: NOW,
    });
    expect(resolved).toMatchObject({ planId: "FREE", source: "FREE", isTrial: false });
  });

  it("puts the complimentary grant above both payers", () => {
    const resolved = resolveEntitlement({
      subscription: stripePaid("PRO"),
      play: [playCandidate({ planId: "BUSINESS" })],
      overridePlanId: "ENTERPRISE",
      edition: "business",
      now: NOW,
    });
    expect(resolved).toMatchObject({ planId: "ENTERPRISE", source: "COMPLIMENTARY" });
  });

  // The bug this replaced: persisting the grant used to overwrite plan/status,
  // so the paid subscription underneath became invisible and withdrawing the
  // grant looked like it had cancelled the customer.
  it("still reports the paid subscriptions underneath a complimentary grant", () => {
    const resolved = resolveEntitlement({
      subscription: {
        ...stripePaid("PRO"),
        // What the cache looks like once the grant has been persisted.
        plan: "ENTERPRISE",
        status: "ACTIVE",
        planSource: "COMPLIMENTARY",
      },
      play: [playCandidate({ planId: "BUSINESS" })],
      overridePlanId: "ENTERPRISE",
      edition: "business",
      now: NOW,
    });
    expect(resolved.candidates.map((candidate) => [candidate.source, candidate.planId])).toEqual([
      ["STRIPE", "PRO"],
      ["GOOGLE_PLAY", "BUSINESS"],
    ]);
  });

  it("withdraws a persisted grant once the address leaves the allowlist", () => {
    const resolved = resolveEntitlement({
      subscription: subscription({
        plan: "ENTERPRISE",
        status: "ACTIVE",
        planSource: "COMPLIMENTARY",
      }),
      play: [],
      overridePlanId: null,
      edition: "business",
      now: NOW,
    });
    expect(resolved).toMatchObject({ planId: "FREE", source: "FREE" });
  });

  it("resolves the personal ladder for a personal workspace", () => {
    const resolved = resolveEntitlement({
      subscription: subscription(),
      play: [playCandidate({ planId: "PREMIUM" }), playCandidate({ planId: "PLUS" })],
      overridePlanId: null,
      edition: "personal",
      now: NOW,
    });
    expect(resolved.planId).toBe("PREMIUM");
  });

  it("prefers the later period end when two payers are on the same tier", () => {
    const resolved = resolveEntitlement({
      subscription: stripePaid("PRO"),
      play: [
        playCandidate({ planId: "PRO", accessUntil: new Date(NOW.getTime() + 60 * 24 * HOUR) }),
      ],
      overridePlanId: null,
      edition: "business",
      now: NOW,
    });
    expect(resolved.source).toBe("GOOGLE_PLAY");
  });

  it("reads a legacy row with no stripe columns as a Stripe subscription", () => {
    const resolved = resolveEntitlement({
      subscription: subscription({ plan: "BUSINESS", status: "ACTIVE" }),
      edition: "business",
      now: NOW,
    });
    expect(resolved).toMatchObject({ planId: "BUSINESS", source: "STRIPE" });
  });

  it("does not read a cached Play plan as a Stripe subscription", () => {
    const cached = subscription({
      plan: "PRO",
      status: "ACTIVE",
      planSource: "GOOGLE_PLAY",
      currentPeriodEnd: new Date(NOW.getTime() + 10 * 24 * HOUR),
    });
    // With no Play rows supplied the cache stands in for them...
    expect(resolveEntitlement({ subscription: cached, edition: "business", now: NOW })).toMatchObject(
      { planId: "PRO", source: "GOOGLE_PLAY" }
    );
    // ...and once Play has actually been consulted, its answer is the only one.
    expect(
      resolveEntitlement({ subscription: cached, play: [], edition: "business", now: NOW })
    ).toMatchObject({ planId: "FREE", source: "FREE" });
  });

  it("knows whether Stripe is currently paying, for the double-charge guard", () => {
    expect(hasEntitlingStripeSubscription(stripePaid("PRO"))).toBe(true);
    expect(hasEntitlingStripeSubscription(stripePaid("PRO", "PAST_DUE"))).toBe(true);
    expect(hasEntitlingStripeSubscription(stripePaid("PRO", "CANCELED"))).toBe(false);
    expect(hasEntitlingStripeSubscription(subscription())).toBe(false);
    // A Play-paid workspace has no Stripe subscription however its cache reads.
    expect(
      hasEntitlingStripeSubscription(
        subscription({ plan: "PRO", status: "ACTIVE", planSource: "GOOGLE_PLAY" })
      )
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* The wire's plan source                                             */
/* ------------------------------------------------------------------ */

describe("the plan source a client switches on", () => {
  it("spells the stored enum the way the wire does", () => {
    expect(planSourceToWire("GOOGLE_PLAY")).toBe("google_play");
    expect(planSourceToWire("STRIPE")).toBe("stripe");
    expect(planSourceToWire("COMPLIMENTARY")).toBe("complimentary");
    expect(planSourceToWire("TRIAL")).toBe("trial");
    expect(planSourceToWire("FREE")).toBe("free");
  });

  const base = {
    ownerEmail: "someone@example.com",
    edition: "business" as const,
    planId: "BUSINESS" as const,
    stripeSubscriptionId: null,
    isTrial: false,
  };

  // This replaces a test that asserted google_play was never returned, which was
  // true only while there was no Play integration to return it for.
  it("reports google_play when the resolver picked Google Play", () => {
    expect(resolvePlanSource({ ...base, resolvedSource: "GOOGLE_PLAY" })).toBe("google_play");
  });

  it("prefers a complimentary grant over anything the resolver says", () => {
    expect(
      resolvePlanSource({
        ...base,
        ownerEmail: "alihbahri@gmail.com",
        resolvedSource: "GOOGLE_PLAY",
      })
    ).toBe("complimentary");
  });

  it("still answers from the row alone when no resolver result is passed", () => {
    expect(resolvePlanSource({ ...base, stripeSubscriptionId: "sub_1" })).toBe("stripe");
    expect(resolvePlanSource({ ...base, planId: "PRO", isTrial: true })).toBe("trial");
    expect(resolvePlanSource(base)).toBe("free");
  });
});
