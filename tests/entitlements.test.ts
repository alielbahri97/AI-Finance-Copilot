import { describe, expect, it } from "vitest";

import type { Subscription } from "@/generated/prisma/client";
import {
  checkLimit,
  currentPeriod,
  limitError,
  resolvePlanId,
  upgradeError,
  type Entitlements,
} from "@/lib/billing/entitlements";
import { getPlan, PLANS } from "@/lib/billing/plans";

const NOW = new Date("2026-07-27T10:00:00Z");

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1",
    userId: "user_1",
    plan: "FREE",
    status: "ACTIVE",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function entitlements(planId: "FREE" | "PRO" | "BUSINESS", usage: Partial<Entitlements["usage"]> = {}): Entitlements {
  return {
    plan: getPlan(planId),
    planId,
    isTrial: false,
    trialEndsAt: null,
    subscriptionStatus: "ACTIVE",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    hasStripeCustomer: false,
    period: "2026-07",
    usage: { aiMessages: 0, csvImports: 0, invoiceExtractions: 0, exports: 0, ...usage },
  };
}

describe("plan matrix", () => {
  it("keeps the free plan restrictive and enterprise unlimited", () => {
    expect(PLANS.FREE.limits.exportsEnabled).toBe(false);
    expect(PLANS.FREE.limits.integrationsEnabled).toBe(false);
    expect(PLANS.ENTERPRISE.limits.aiMessagesPerMonth).toBeNull();
  });

  it("gates integrations to Business and above", () => {
    expect(PLANS.PRO.limits.integrationsEnabled).toBe(false);
    expect(PLANS.BUSINESS.limits.integrationsEnabled).toBe(true);
  });
});

describe("resolvePlanId", () => {
  it("prefers a paid Stripe plan", () => {
    const { planId, isTrial } = resolvePlanId(
      subscription({ plan: "BUSINESS", status: "ACTIVE" }),
      NOW
    );
    expect(planId).toBe("BUSINESS");
    expect(isTrial).toBe(false);
  });

  it("grants the local Pro trial while it lasts", () => {
    const inTrial = resolvePlanId(
      subscription({ trialEndsAt: new Date(NOW.getTime() + 86_400_000) }),
      NOW
    );
    expect(inTrial).toEqual({ planId: "PRO", isTrial: true });
  });

  it("falls back to Free after the trial expires", () => {
    const expired = resolvePlanId(
      subscription({ trialEndsAt: new Date(NOW.getTime() - 1000) }),
      NOW
    );
    expect(expired).toEqual({ planId: "FREE", isTrial: false });
  });

  it("does not honor a canceled paid plan", () => {
    const { planId } = resolvePlanId(subscription({ plan: "PRO", status: "CANCELED" }), NOW);
    expect(planId).toBe("FREE");
  });
});

describe("checkLimit", () => {
  it("treats null limits as unlimited", () => {
    expect(checkLimit(entitlements("BUSINESS"), "aiMessages", null)).toEqual({
      allowed: true,
      remaining: null,
    });
  });

  it("allows under the limit and reports the remainder", () => {
    const result = checkLimit(entitlements("FREE", { aiMessages: 30 }), "aiMessages", 50);
    expect(result).toEqual({ allowed: true, remaining: 20 });
  });

  it("blocks at the limit", () => {
    const result = checkLimit(entitlements("FREE", { aiMessages: 50 }), "aiMessages", 50);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

describe("period and error payloads", () => {
  it("formats the usage period as YYYY-MM (UTC)", () => {
    expect(currentPeriod(new Date("2026-01-31T23:30:00Z"))).toBe("2026-01");
    expect(currentPeriod(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12");
  });

  it("produces machine-readable upgrade and limit errors", () => {
    expect(upgradeError("Report exports", "FREE").code).toBe("UPGRADE_REQUIRED");
    expect(limitError("AI messages", "PRO")).toMatchObject({
      code: "LIMIT_REACHED",
      feature: "AI messages",
      plan: "PRO",
    });
  });
});
