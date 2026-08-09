/**
 * Complimentary plan grants by email.
 *
 * These override Stripe / trial resolution for every workspace the user owns.
 * Business workspaces get Enterprise; Personal workspaces get Premium (the top
 * personal tier), so personal-only features stay unlocked while cross-edition
 * access matches Enterprise.
 */

import type { Edition } from "@/lib/branding";

import type { PlanId } from "./plans";

/** Emails that receive the top paid tier on every owned workspace. */
const COMPED_ENTERPRISE_EMAILS = new Set([
  "dimitrsspirakis@gmail.com",
  "nour.bahri@icloud.com",
]);

export function normalizeBillingEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/** True when this address is on the complimentary Enterprise allowlist. */
export function isCompedEnterpriseEmail(email: string | null | undefined): boolean {
  const normalized = normalizeBillingEmail(email);
  return normalized !== null && COMPED_ENTERPRISE_EMAILS.has(normalized);
}

/**
 * Plan to grant when the workspace owner is allowlisted.
 * Returns null when the email has no override.
 */
export function overriddenPlanForEmail(
  email: string | null | undefined,
  edition: Edition
): PlanId | null {
  if (!isCompedEnterpriseEmail(email)) return null;
  return edition === "personal" ? "PREMIUM" : "ENTERPRISE";
}
