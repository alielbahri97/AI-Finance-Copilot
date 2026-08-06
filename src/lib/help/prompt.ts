import { BRAND, DEFAULT_EDITION, editionBranding, type Edition } from "@/lib/branding";

import type { HelpTopic } from "./knowledge";

/**
 * System prompt for the help agent. Deliberately distinct from the finance
 * copilot: this assistant knows how the app works, not the user's numbers.
 *
 * The prompt is edition-scoped: the app map lists only the pages the user's
 * workspace actually has, and the retrieved articles are already filtered, so
 * the agent cannot walk someone through a page their workspace blocks.
 */

/** Compact app map so links and page names are always correct. */
const SHARED_PAGES = [
  "Dashboard (/dashboard)",
  "Transactions (/transactions)",
  "Import (/import)",
  "Categories (/categories)",
];

const TAIL_PAGES = [
  "Forecast (/forecast)",
  "Reports (/reports)",
  "Copilot (/copilot)",
  "Integrations (/integrations)",
  "Billing (/billing)",
  "Profile (/profile)",
  "Settings (/settings)",
  "Help (/help)",
];

const EDITION_PAGES: Record<Edition, string[]> = {
  business: ["Invoices (/invoices)"],
  personal: ["Budgets (/budgets)", "Goals (/goals)", "Subscriptions (/subscriptions)"],
};

function appMap(edition: Edition): string {
  const pages = [...SHARED_PAGES, ...EDITION_PAGES[edition], ...TAIL_PAGES];
  return `Pages (sidebar navigation): ${pages.join(", ")}.`;
}

/** What this edition does not have, so the agent never offers it. */
const ABSENT: Record<Edition, string> = {
  business:
    "This workspace has no budgets, savings goals or subscription tracking — those are Ballast Personal features. If asked, say a personal workspace has them. Creating one alongside a company workspace needs Enterprise or Premium.",
  personal:
    "This is a personal workspace: it has no invoices, no VAT extraction, no vendors/customers or AR/AP reporting, and no team members or invitations — those are Ballast Business features. Never give steps for them. If asked, say they belong to a business workspace; adding one alongside Personal needs Premium or Enterprise.",
};

export interface HelpUserContext {
  /** Which edition the user's current workspace is. */
  edition: Edition;
  planName: string;
  integrationsEnabled: boolean;
  /** Provider ids configured server-side (credentials present). */
  configuredProviders: string[];
  /** Provider ids NOT configured server-side. */
  unconfiguredProviders: string[];
  /** e.g. { gocardless: "CONNECTED" } for the user's connections. */
  connectionStatuses: Record<string, string>;
  transactionCount: number;
  invoiceCount: number;
}

export function buildUserContextBlock(context: HelpUserContext): string {
  const connections = Object.entries(context.connectionStatuses);
  return [
    `- Workspace: ${editionBranding(context.edition).name}`,
    `- Plan: ${context.planName} (integrations ${
      context.integrationsEnabled ? "included" : "NOT included — needs Business plan or higher"
    })`,
    context.edition === "personal"
      ? `- Data so far: ${context.transactionCount} transactions`
      : `- Data so far: ${context.transactionCount} transactions, ${context.invoiceCount} invoices`,
    `- Integrations configured on this server: ${
      context.configuredProviders.length > 0 ? context.configuredProviders.join(", ") : "none"
    }`,
    `- Integrations NOT configured on this server (need an administrator): ${
      context.unconfiguredProviders.length > 0 ? context.unconfiguredProviders.join(", ") : "none"
    }`,
    `- User's existing connections: ${
      connections.length > 0
        ? connections.map(([provider, status]) => `${provider} (${status})`).join(", ")
        : "none"
    }`,
  ].join("\n");
}

export function buildHelpSystemPrompt(
  topics: HelpTopic[],
  context: HelpUserContext
): string {
  const knowledge = topics
    .map((topic) => `### ${topic.title}\n${topic.content}`)
    .join("\n\n");

  const edition = context.edition ?? DEFAULT_EDITION;

  return `You are the friendly in-app support assistant for ${editionBranding(edition).name}, ${BRAND.name} for ${editionBranding(edition).audience}. Your job is to explain HOW TO USE the app — you are not the Finance Copilot and you cannot see the user's financial data or numbers.

${appMap(edition)}

${ABSENT[edition]}

## This user's situation
${buildUserContextBlock(context)}

## Relevant help articles
${knowledge}

## How to answer
- Give short, numbered step-by-step instructions that match the app's real page names and button labels, exactly as written in the help articles.
- Link to app pages with relative markdown links, e.g. [Import](/import) — the chat renders them as navigation.
- Tailor to the user's situation: if a needed integration is not configured on this server, say an administrator must set it up first (the integration tile's detail view shows them how). If a feature needs a higher plan, say which plan and link to [Billing](/billing).
- Only describe features that exist in the help articles above. If something isn't supported or you don't know, say so honestly — never invent buttons, pages or capabilities.
- If the user asks about their own numbers, balances or forecasts, point them to the [Copilot](/copilot) — that's what it's for.
- If they report a bug or you genuinely can't help, suggest the "Report issue" button at the bottom of the sidebar so the team hears about it.
- Keep replies compact and warm. Answer in the user's language when they don't write English.`;
}
