/**
 * Single source of truth for plans, pricing and limits. Everything that
 * gates a feature or renders pricing reads from this file.
 */

import { BRAND } from "@/lib/branding";

export type PlanId = "FREE" | "PRO" | "BUSINESS" | "ENTERPRISE";

export interface PlanLimits {
  /** CSV imports per calendar month; null = unlimited. */
  csvImportsPerMonth: number | null;
  /** Max rows accepted in a single CSV import; null = unlimited (engine cap applies). */
  rowsPerImport: number | null;
  /** AI copilot messages per calendar month; null = unlimited. */
  aiMessagesPerMonth: number | null;
  /** AI invoice extractions per calendar month; null = unlimited. */
  invoiceExtractionsPerMonth: number | null;
  /** PDF/Excel/CSV report exports. */
  exportsEnabled: boolean;
  /** What-if assumptions on the forecast page. */
  assumptionsEnabled: boolean;
  /** Bank/accounting/productivity integrations (Business and up). */
  integrationsEnabled: boolean;
  /** Workspace seats (members + pending invitations); null = custom/unlimited. */
  seats: number | null;
}

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** USD per month; 0 = free, null = contact sales. */
  monthlyPriceUsd: number | null;
  /** Env var holding the Stripe price id (self-serve paid plans only). */
  priceEnvVar?: string;
  limits: PlanLimits;
  highlights: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: "FREE",
    name: "Free",
    description: `Get a feel for ${BRAND.name} with your own data.`,
    monthlyPriceUsd: 0,
    limits: {
      csvImportsPerMonth: 1,
      rowsPerImport: 100,
      aiMessagesPerMonth: 50,
      invoiceExtractionsPerMonth: 5,
      exportsEnabled: false,
      assumptionsEnabled: false,
      integrationsEnabled: false,
      seats: 1,
    },
    highlights: [
      "1 CSV import per month (100 rows)",
      "50 AI copilot messages per month",
      "5 AI invoice extractions per month",
      "Dashboard, forecasting & reports (view only)",
    ],
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    description: "For freelancers and solo founders running real finances.",
    monthlyPriceUsd: 19,
    priceEnvVar: "STRIPE_PRICE_PRO",
    limits: {
      csvImportsPerMonth: null,
      rowsPerImport: 5000,
      aiMessagesPerMonth: 500,
      invoiceExtractionsPerMonth: 50,
      exportsEnabled: true,
      assumptionsEnabled: true,
      integrationsEnabled: false,
      seats: 1,
    },
    highlights: [
      "Unlimited CSV imports (5,000 rows each)",
      "500 AI copilot messages per month",
      "50 AI invoice extractions per month",
      "PDF, Excel & CSV exports",
      "What-if forecast assumptions",
    ],
  },
  BUSINESS: {
    id: "BUSINESS",
    name: "Business",
    description: "For teams that live in their numbers every day.",
    monthlyPriceUsd: 49,
    priceEnvVar: "STRIPE_PRICE_BUSINESS",
    limits: {
      csvImportsPerMonth: null,
      rowsPerImport: 20000,
      aiMessagesPerMonth: null,
      invoiceExtractionsPerMonth: 500,
      exportsEnabled: true,
      assumptionsEnabled: true,
      integrationsEnabled: true,
      seats: 5,
    },
    highlights: [
      "Everything in Pro",
      "Unlimited AI copilot messages",
      "500 AI invoice extractions per month",
      "Bank, accounting & productivity integrations",
      "20,000 rows per import",
      "5 seats included",
    ],
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    description: "Custom limits, onboarding and support.",
    monthlyPriceUsd: null,
    limits: {
      csvImportsPerMonth: null,
      rowsPerImport: null,
      aiMessagesPerMonth: null,
      invoiceExtractionsPerMonth: null,
      exportsEnabled: true,
      assumptionsEnabled: true,
      integrationsEnabled: true,
      seats: null,
    },
    highlights: [
      "Everything in Business",
      "Unlimited usage across all features",
      "Custom contracts & invoicing",
      "Dedicated support",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["FREE", "PRO", "BUSINESS", "ENTERPRISE"];

/** Self-serve upgrade targets (Enterprise is contact-sales). */
export const CHECKOUT_PLANS: PlanId[] = ["PRO", "BUSINESS"];

export const TRIAL_DAYS = 14;

/** The plan granted during the card-free signup trial. */
export const TRIAL_PLAN: PlanId = "PRO";

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

/** Resolves the Stripe price id for a plan from the environment, if any. */
export function getPlanPriceId(id: PlanId): string | null {
  const envVar = PLANS[id].priceEnvVar;
  if (!envVar) return null;
  return process.env[envVar] || null;
}

/** Reverse lookup: which plan does a Stripe price id belong to? */
export function planFromPriceId(priceId: string): PlanId | null {
  for (const id of CHECKOUT_PLANS) {
    if (getPlanPriceId(id) === priceId) return id;
  }
  return null;
}
