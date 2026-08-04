/**
 * Single source of truth for plans, pricing and limits. Everything that gates
 * a feature or renders pricing reads from this file.
 *
 * There are two tier sets, one per edition:
 *
 *   Business   Free · Pro €19 · Business €49 · Enterprise
 *   Personal   Free · Plus €4.99 · Premium €8.99
 *
 * `FREE` exists in both with different limits — a personal Free account gets
 * one bank connection and budgets, a business Free account gets neither — so
 * a plan is only fully resolved once you know the workspace's edition. Use
 * `getPlan(id, edition)`; the edition-less `PLANS` lookup answers with the
 * Business definitions and exists for edition-agnostic call sites (the admin
 * revenue roll-up, the help knowledge base).
 *
 * The stored `PlanId` enum is shared by both editions. Nothing stops a row
 * from holding a tier its edition does not sell (a workspace type is fixed at
 * creation, so in practice nothing does), and the resolver falls back to the
 * tier's own definition rather than silently downgrading anyone.
 */

import { BRAND, DEFAULT_EDITION, type Edition } from "@/lib/branding";

export type PlanId = "FREE" | "PRO" | "BUSINESS" | "ENTERPRISE" | "PLUS" | "PREMIUM";

export interface PlanLimits {
  /** CSV imports per calendar month; null = unlimited. */
  csvImportsPerMonth: number | null;
  /** Max rows accepted in a single CSV import; null = unlimited (engine cap applies). */
  rowsPerImport: number | null;
  /** AI copilot messages per calendar month; null = unlimited. */
  aiMessagesPerMonth: number | null;
  /** AI invoice extractions per calendar month; null = unlimited. 0 on Personal, which has no invoices. */
  invoiceExtractionsPerMonth: number | null;
  /** PDF/Excel/CSV report exports. */
  exportsEnabled: boolean;
  /** What-if assumptions on the forecast page. */
  assumptionsEnabled: boolean;
  /** Bank/accounting/productivity integrations at all. */
  integrationsEnabled: boolean;
  /** Simultaneous bank connections; null = unlimited, 0 = none. */
  bankConnections: number | null;
  /** Savings goals (Personal edition). */
  goalsEnabled: boolean;
  /** Recurring-subscription insights (Personal edition). */
  subscriptionInsightsEnabled: boolean;
  /** Workspace seats (members + pending invitations); null = custom/unlimited. */
  seats: number | null;
}

export interface Plan {
  id: PlanId;
  /** Which edition sells this tier. */
  edition: Edition;
  name: string;
  description: string;
  /** EUR per month; 0 = free, null = contact sales. */
  monthlyPriceEur: number | null;
  /** Env var holding the Stripe price id (self-serve paid plans only). */
  priceEnvVar?: string;
  limits: PlanLimits;
  highlights: string[];
}

/* ------------------------------------------------------------------ */
/* Business edition                                                    */
/* ------------------------------------------------------------------ */

const BUSINESS_FREE: Plan = {
  id: "FREE",
  edition: "business",
  name: "Free",
  description: `Get a feel for ${BRAND.name} with your own data.`,
  monthlyPriceEur: 0,
  limits: {
    csvImportsPerMonth: 1,
    rowsPerImport: 100,
    aiMessagesPerMonth: 50,
    invoiceExtractionsPerMonth: 5,
    exportsEnabled: false,
    assumptionsEnabled: false,
    integrationsEnabled: false,
    bankConnections: 0,
    goalsEnabled: false,
    subscriptionInsightsEnabled: false,
    seats: 1,
  },
  highlights: [
    "1 CSV import per month (100 rows)",
    "50 AI copilot messages per month",
    "5 AI invoice extractions per month",
    "Dashboard, forecasting & reports (view only)",
  ],
};

const PRO: Plan = {
  id: "PRO",
  edition: "business",
  name: "Pro",
  description: "For freelancers and solo founders running real finances.",
  monthlyPriceEur: 19,
  priceEnvVar: "STRIPE_PRICE_PRO",
  limits: {
    csvImportsPerMonth: null,
    rowsPerImport: 5000,
    aiMessagesPerMonth: 500,
    invoiceExtractionsPerMonth: 50,
    exportsEnabled: true,
    assumptionsEnabled: true,
    integrationsEnabled: false,
    bankConnections: 0,
    goalsEnabled: false,
    subscriptionInsightsEnabled: false,
    seats: 1,
  },
  highlights: [
    "Unlimited CSV imports (5,000 rows each)",
    "500 AI copilot messages per month",
    "50 AI invoice extractions per month",
    "PDF, Excel & CSV exports",
    "What-if forecast assumptions",
  ],
};

const BUSINESS: Plan = {
  id: "BUSINESS",
  edition: "business",
  name: "Business",
  description: "For teams that live in their numbers every day.",
  monthlyPriceEur: 49,
  priceEnvVar: "STRIPE_PRICE_BUSINESS",
  limits: {
    csvImportsPerMonth: null,
    rowsPerImport: 20000,
    aiMessagesPerMonth: null,
    invoiceExtractionsPerMonth: 500,
    exportsEnabled: true,
    assumptionsEnabled: true,
    integrationsEnabled: true,
    bankConnections: null,
    goalsEnabled: false,
    subscriptionInsightsEnabled: false,
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
};

const ENTERPRISE: Plan = {
  id: "ENTERPRISE",
  edition: "business",
  name: "Enterprise",
  description: "Custom limits, onboarding and support.",
  monthlyPriceEur: null,
  limits: {
    csvImportsPerMonth: null,
    rowsPerImport: null,
    aiMessagesPerMonth: null,
    invoiceExtractionsPerMonth: null,
    exportsEnabled: true,
    assumptionsEnabled: true,
    integrationsEnabled: true,
    bankConnections: null,
    goalsEnabled: false,
    subscriptionInsightsEnabled: false,
    seats: null,
  },
  highlights: [
    "Everything in Business",
    "Unlimited usage across all features",
    "Custom contracts & invoicing",
    "Dedicated support",
  ],
};

/* ------------------------------------------------------------------ */
/* Personal edition                                                    */
/* ------------------------------------------------------------------ */

/**
 * One bank is enough to see where the money goes, which is the point of the
 * free tier: budgets are included rather than teased, because a budget nobody
 * can set is not a demo of anything.
 */
const PERSONAL_FREE: Plan = {
  id: "FREE",
  edition: "personal",
  name: "Free",
  description: "See where your money goes, and budget for it.",
  monthlyPriceEur: 0,
  limits: {
    csvImportsPerMonth: 2,
    rowsPerImport: 500,
    aiMessagesPerMonth: 50,
    invoiceExtractionsPerMonth: 0,
    exportsEnabled: false,
    assumptionsEnabled: false,
    integrationsEnabled: true,
    bankConnections: 1,
    goalsEnabled: false,
    subscriptionInsightsEnabled: false,
    seats: 1,
  },
  highlights: [
    "1 bank connection",
    "50 AI copilot messages per month",
    "Dashboard, spending breakdown & forecast",
    "Monthly budgets per category",
  ],
};

const PLUS: Plan = {
  id: "PLUS",
  edition: "personal",
  name: "Plus",
  description: "Every account in one place, with goals to save towards.",
  monthlyPriceEur: 4.99,
  priceEnvVar: "STRIPE_PRICE_PERSONAL_PLUS",
  limits: {
    csvImportsPerMonth: null,
    rowsPerImport: 5000,
    aiMessagesPerMonth: 500,
    invoiceExtractionsPerMonth: 0,
    exportsEnabled: true,
    assumptionsEnabled: false,
    integrationsEnabled: true,
    bankConnections: null,
    goalsEnabled: true,
    subscriptionInsightsEnabled: true,
    seats: 1,
  },
  highlights: [
    "Unlimited bank connections",
    "500 AI copilot messages per month",
    "Savings goals with projected completion dates",
    "Subscription insights: monthly cost, price rises, unused",
    "PDF, Excel & CSV exports",
  ],
};

const PREMIUM: Plan = {
  id: "PREMIUM",
  edition: "personal",
  name: "Premium",
  description: "Everything, with an AI copilot you never have to ration.",
  monthlyPriceEur: 8.99,
  priceEnvVar: "STRIPE_PRICE_PERSONAL_PREMIUM",
  limits: {
    csvImportsPerMonth: null,
    rowsPerImport: 20000,
    aiMessagesPerMonth: null,
    invoiceExtractionsPerMonth: 0,
    exportsEnabled: true,
    assumptionsEnabled: true,
    integrationsEnabled: true,
    bankConnections: null,
    goalsEnabled: true,
    subscriptionInsightsEnabled: true,
    seats: 1,
  },
  highlights: [
    "Everything in Plus",
    "Unlimited AI copilot messages",
    "What-if planning: model a raise, a move, a big purchase",
    "20,000 rows per import",
  ],
};

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/**
 * Edition-agnostic lookup by stored id. `FREE` resolves to the Business
 * definition; anything that knows the workspace should call `getPlan(id,
 * edition)` instead.
 */
export const PLANS: Record<PlanId, Plan> = {
  FREE: BUSINESS_FREE,
  PRO,
  BUSINESS,
  ENTERPRISE,
  PLUS,
  PREMIUM,
};

/** The tiers each edition actually sells. */
export const EDITION_PLANS: Record<Edition, Partial<Record<PlanId, Plan>>> = {
  business: { FREE: BUSINESS_FREE, PRO, BUSINESS, ENTERPRISE },
  personal: { FREE: PERSONAL_FREE, PLUS, PREMIUM },
};

/** Display order, cheapest first. */
export const EDITION_PLAN_ORDER: Record<Edition, readonly PlanId[]> = {
  business: ["FREE", "PRO", "BUSINESS", "ENTERPRISE"],
  personal: ["FREE", "PLUS", "PREMIUM"],
};

/** Self-serve upgrade targets. Business Enterprise is contact-sales. */
export const EDITION_CHECKOUT_PLANS: Record<Edition, readonly PlanId[]> = {
  business: ["PRO", "BUSINESS"],
  personal: ["PLUS", "PREMIUM"],
};

export const TRIAL_DAYS = 14;

/**
 * The plan granted during the card-free signup trial: the middle tier of the
 * edition, so a trial shows off what the product does without handing over
 * the top tier for free.
 */
export const EDITION_TRIAL_PLAN: Record<Edition, PlanId> = {
  business: "PRO",
  personal: "PLUS",
};

export function planOrder(edition: Edition = DEFAULT_EDITION): readonly PlanId[] {
  return EDITION_PLAN_ORDER[edition];
}

export function checkoutPlans(edition: Edition = DEFAULT_EDITION): readonly PlanId[] {
  return EDITION_CHECKOUT_PLANS[edition];
}

export function trialPlan(edition: Edition = DEFAULT_EDITION): PlanId {
  return EDITION_TRIAL_PLAN[edition];
}

/**
 * The plan definition to apply. Falls back to the edition-agnostic definition
 * when a workspace somehow holds a tier its edition does not sell, so a
 * mismatch never costs the customer entitlements they have paid for.
 */
export function getPlan(id: PlanId, edition: Edition = DEFAULT_EDITION): Plan {
  return EDITION_PLANS[edition][id] ?? PLANS[id];
}

/** Whether a tier belongs to an edition's line-up. */
export function planBelongsToEdition(id: PlanId, edition: Edition): boolean {
  return id in EDITION_PLANS[edition];
}

/** Resolves the Stripe price id for a plan from the environment, if any. */
export function getPlanPriceId(id: PlanId, edition: Edition = DEFAULT_EDITION): string | null {
  const envVar = getPlan(id, edition).priceEnvVar;
  if (!envVar) return null;
  return process.env[envVar] || null;
}

/**
 * Reverse lookup for the Stripe webhook: which tier does a price id belong to?
 * Searches both editions, because the webhook only has the price.
 */
export function planFromPriceId(priceId: string): { planId: PlanId; edition: Edition } | null {
  for (const edition of ["business", "personal"] as const) {
    for (const id of EDITION_CHECKOUT_PLANS[edition]) {
      if (getPlanPriceId(id, edition) === priceId) return { planId: id, edition };
    }
  }
  return null;
}

/** Every self-serve price env var, for the billing configuration check. */
export function allPriceEnvVars(): string[] {
  const vars = new Set<string>();
  for (const edition of ["business", "personal"] as const) {
    for (const id of EDITION_CHECKOUT_PLANS[edition]) {
      const envVar = getPlan(id, edition).priceEnvVar;
      if (envVar) vars.add(envVar);
    }
  }
  return [...vars];
}

export interface BankConnectionCheck {
  allowed: boolean;
  used: number;
  limit: number | null;
}

/** Bank-connection quota: counted like seats, enforced where a bank is linked. */
export function canAddBankConnection(
  current: number,
  limit: number | null
): BankConnectionCheck {
  return {
    allowed: limit === null || current < limit,
    used: current,
    limit,
  };
}

/** Price as shown in the UI: "Free", "€4.99", "€19", or null for contact-sales. */
export function formatPlanPrice(plan: Plan): string | null {
  if (plan.monthlyPriceEur === null) return null;
  if (plan.monthlyPriceEur === 0) return "Free";
  return Number.isInteger(plan.monthlyPriceEur)
    ? `€${plan.monthlyPriceEur}`
    : `€${plan.monthlyPriceEur.toFixed(2)}`;
}
