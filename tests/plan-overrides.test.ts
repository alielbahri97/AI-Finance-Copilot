import { describe, expect, it } from "vitest";

import {
  isCompedEnterpriseEmail,
  normalizeBillingEmail,
  overriddenPlanForEmail,
} from "@/lib/billing/plan-overrides";

describe("plan overrides", () => {
  it("normalizes emails for allowlist matching", () => {
    expect(normalizeBillingEmail("  Nour.Bahri@iCloud.com ")).toBe("nour.bahri@icloud.com");
    expect(normalizeBillingEmail("")).toBeNull();
    expect(normalizeBillingEmail(null)).toBeNull();
  });

  it("recognizes complimentary Enterprise emails case-insensitively", () => {
    expect(isCompedEnterpriseEmail("dimitrsspirakis@gmail.com")).toBe(true);
    expect(isCompedEnterpriseEmail("DimitrsSpirakis@Gmail.com")).toBe(true);
    expect(isCompedEnterpriseEmail("Nour.bahri@icloud.com")).toBe(true);
    expect(isCompedEnterpriseEmail("alihbahri@gmail.com")).toBe(true);
    expect(isCompedEnterpriseEmail("AliHBahri@Gmail.com")).toBe(true);
    expect(isCompedEnterpriseEmail("someone@example.com")).toBe(false);
  });

  it("grants Enterprise on Business and Premium on Personal", () => {
    expect(overriddenPlanForEmail("dimitrsspirakis@gmail.com", "business")).toBe("ENTERPRISE");
    expect(overriddenPlanForEmail("nour.bahri@icloud.com", "personal")).toBe("PREMIUM");
    expect(overriddenPlanForEmail("alihbahri@gmail.com", "business")).toBe("ENTERPRISE");
    expect(overriddenPlanForEmail("other@example.com", "business")).toBeNull();
  });
});
