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

/**
 * How an edition talks about sharing a workspace with someone else. The
 * machinery underneath is identical — members, hashed invitations, seats — but
 * a company invites colleagues to a *team* and a couple shares a *household*,
 * and every string the sharing UI renders comes from here so neither edition's
 * wording is baked into a component.
 */
export interface EditionSharingCopy {
  /** Settings section heading: "Team" / "Household". */
  title: string;
  /** Under the heading, for someone who can invite. */
  description: string;
  /** Under the heading, for someone who can only look. */
  readOnlyDescription: string;
  /** The invite button, and the invite dialog's title. */
  inviteAction: string;
  /** The invite dialog's one-line explanation. */
  inviteDescription: string;
  /** What one of the other people is called, inside a sentence. */
  personLabel: string;
  /** Subject of "… is part of Premium" on the locked teaser. */
  lockedSubject: string;
  /** What sharing buys you, listed under the teaser. */
  lockedHighlights: readonly string[];
  /** Shown once sharing is unlocked but nobody has been invited yet. */
  emptyTitle: string;
  emptyDescription: string;
}

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
  /** Wording for the members/invitations surface in Settings. */
  sharing: EditionSharingCopy;
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
    sharing: {
      title: "Team",
      description:
        "Invite people to this workspace and control what each member can access.",
      readOnlyDescription: "People who share this workspace with you.",
      inviteAction: "Invite member",
      inviteDescription:
        "They get their own login; you control what they can see and do. Invitations expire after 7 days.",
      personLabel: "member",
      lockedSubject: "Extra seats",
      lockedHighlights: [
        "Your accountant, co-founder or bookkeeper gets their own login.",
        "Roles and per-permission overrides decide what each of them can reach.",
        "An audit log records who changed what.",
      ],
      emptyTitle: "Nobody else here yet",
      emptyDescription:
        "Invite a colleague or your accountant and they get their own login into this workspace.",
    },
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
    sharing: {
      title: "Household",
      description:
        "Share this workspace with your partner. You both see the same accounts, transactions, budgets and goals.",
      readOnlyDescription: "The people you share this workspace with.",
      inviteAction: "Invite your partner",
      inviteDescription:
        "They get their own login and see everything here as an equal. The plan and this list stay with you. The invitation expires after 7 days.",
      personLabel: "partner",
      lockedSubject: "Managing money together",
      lockedHighlights: [
        "Your partner gets their own login — no shared password, no shared inbox.",
        "One set of accounts, transactions, budgets and goals for both of you.",
        "They can import and categorize transactions and ask the copilot.",
        "The plan stays yours: only you can change it or invite anyone.",
      ],
      emptyTitle: "It is just you in here",
      emptyDescription:
        "Invite your partner and you will both be working from the same numbers.",
    },
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
