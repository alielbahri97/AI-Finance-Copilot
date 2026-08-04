/**
 * Product naming and marketing copy, in one place.
 *
 * Every user-visible occurrence of the product name, tagline or description
 * reads from here — metadata, the PWA manifest, emails, AI prompts, exports and
 * the help knowledge base — so a future rename is a single-file edit.
 *
 * The per-edition entries exist because Ballast ships as a Business / Personal
 * dual edition: both editions ship under the same `Ballast` name, domain and
 * logo, and only the audience-facing copy differs. A workspace's type picks
 * the entry — see `src/lib/workspace/editions.ts`.
 *
 * Copy constraint: never use the phrase "Your AI finance copilot". It is the
 * verbatim headline of a competitor, and avoiding the collision is the reason
 * this product stopped being called FinPilot.
 */

export type Edition = "business" | "personal";

export interface EditionBranding {
  /** Full product name for this edition, e.g. for plan pages and packaging. */
  name: string;
  /** What the edition is sold as, one line. */
  tagline: string;
  /** Who it is for, as it reads inside a sentence. */
  audience: string;
  /** Long-form copy for landing/marketing surfaces. */
  description: string;
  /** The landing page's choice button: how a visitor says which they are. */
  choiceLabel: string;
  /** One line under the choice, naming the concrete job it does. */
  choiceDescription: string;
  /** What this edition gives you, for the landing choice card. */
  highlights: readonly string[];
  /**
   * A subtle accent per edition. Both editions keep one visual identity and
   * the same logo; this only tints the choice card and the edition badge, so
   * the two are distinguishable without becoming different products.
   */
  accentClassName: string;
}

/** Edition-agnostic branding. Safe anywhere the edition is unknown. */
export const BRAND = {
  name: "Ballast",
  /**
   * Neutral tagline. Used by page metadata, the PWA manifest and emails, which
   * are shared by both editions.
   */
  tagline: "AI-powered clarity on your money",
  description:
    "Ballast turns your bank statements and invoices into clear numbers, forecasts and answers, with an AI copilot grounded in your real data.",
  domain: "ballastmoney.com",
  /** Default public origin. Overridden per deployment by NEXT_PUBLIC_APP_URL. */
  appUrl: "https://app.ballastmoney.com",
  supportEmail: "support@ballastmoney.com",
  salesEmail: "sales@ballastmoney.com",
} as const;

export const EDITIONS: Record<Edition, EditionBranding> = {
  business: {
    name: `${BRAND.name} Business`,
    tagline: "Your AI copilot for business finances",
    audience: "small and medium-sized businesses",
    description:
      "Your AI copilot for business finances. Track income and expenses, chase invoices, forecast cash flow, and get grounded answers about your numbers.",
    choiceLabel: "For my business",
    choiceDescription: "Invoices, VAT, cash flow and a team that shares the numbers.",
    highlights: [
      "Invoices in and out, with AI extraction and VAT",
      "Who owes you, and who you owe",
      "Cash-flow forecast and runway",
      "Executive reports with top vendors and customers",
      "Invite your accountant or co-founder",
    ],
    accentClassName: "text-primary",
  },
  personal: {
    name: `${BRAND.name} Personal`,
    tagline: "Your AI copilot for personal finances",
    audience: "people managing their own money",
    description:
      "Your AI copilot for personal finances. See where your money goes, budget by category, track savings goals, and plan ahead with confidence.",
    choiceLabel: "For myself",
    choiceDescription: "Budgets, savings goals and every subscription you forgot about.",
    highlights: [
      "Where your money actually went this month",
      "A monthly budget per category, with rollover",
      "Savings goals with a real completion date",
      "Every recurring subscription and what it costs you",
      "Ask the copilot whether you can afford something",
    ],
    accentClassName: "text-success",
  },
};

/** Existing accounts and every current surface are the Business edition. */
export const DEFAULT_EDITION: Edition = "business";

export function editionBranding(edition: Edition = DEFAULT_EDITION): EditionBranding {
  return EDITIONS[edition];
}

/** Document title default, e.g. "Ballast — AI-powered clarity on your money". */
export const BRAND_TITLE = `${BRAND.name} — ${BRAND.tagline}`;

/** Next.js title template for nested pages. */
export const BRAND_TITLE_TEMPLATE = `%s | ${BRAND.name}`;

/** Lowercase, filesystem-safe form for download filenames and cache keys. */
export const BRAND_SLUG = BRAND.name.toLowerCase();
