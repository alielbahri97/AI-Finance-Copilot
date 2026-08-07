/**
 * First-login product tour: edition-aware copy and pure helpers.
 *
 * The tour runs once after auth + onboarding, on the dashboard. Skip and
 * complete both set `tourCompletedAt` on the profile so it never returns.
 */

import { BRAND, editionBranding, type Edition } from "@/lib/branding";

export type TourStepId =
  | "welcome"
  | "connect"
  | "transactions"
  | "dashboard"
  | "copilot"
  | "cta";

export interface TourStep {
  id: TourStepId;
  title: string;
  body: string;
  /** Optional primary action on the final step. */
  href?: string;
  hrefLabel?: string;
}

/** True when the user has already finished or skipped the tour. */
export function isProductTourDone(
  profile: { tourCompletedAt?: Date | string | null } | null | undefined
): boolean {
  return Boolean(profile?.tourCompletedAt);
}

/** Ordered steps for the given branding edition. */
export function productTourSteps(edition: Edition): TourStep[] {
  const brand = editionBranding(edition);
  const isPersonal = edition === "personal";

  return [
    {
      id: "welcome",
      title: `Welcome to ${brand.name}`,
      body: isPersonal
        ? `${BRAND.name} helps you see where your money goes, stay on budget, and plan ahead — with an AI copilot grounded in your real numbers.`
        : `${BRAND.name} turns bank statements and invoices into clear cash flow, forecasts, and answers — with an AI copilot grounded in your real data.`,
    },
    {
      id: "connect",
      title: "Get your transactions in",
      body: isPersonal
        ? "Connect a bank on Integrations, or import a CSV statement on Import. Either path fills your dashboard in minutes."
        : "Import a CSV bank statement on Import, or connect a bank on Integrations (Business plan). That's the foundation everything else builds on.",
    },
    {
      id: "transactions",
      title: "Review transactions & categories",
      body: "Open Transactions to check how spending was categorized. Fix a few rows or add rules — cleaner categories make budgets, reports, and the copilot sharper.",
    },
    {
      id: "dashboard",
      title: isPersonal ? "Your dashboard & budgets" : "Your cash overview",
      body: isPersonal
        ? "The Dashboard shows money in vs out, category spend, and balance over time. Set monthly Budgets for the categories you care about so progress is visible at a glance."
        : "The Dashboard shows income vs expenses, cash balance history, and spending by category. Use Forecast for runway, and Invoices when you need to track what you owe or are owed.",
    },
    {
      id: "copilot",
      title: "Ask Copilot",
      body: isPersonal
        ? 'Open Copilot and ask anything about your numbers — "Where did my money go this month?" or "Can I afford a holiday?" Answers use your real data.'
        : 'Open Copilot and ask about your numbers — "What did I spend on software last month?" or "Can I afford a new hire?" Answers stay grounded in your data.',
    },
    {
      id: "cta",
      title: "You're ready",
      body: isPersonal
        ? "Start by importing transactions or connecting a bank. You can reopen tips anytime from Help."
        : "Start by importing a statement or connecting a bank. You can reopen tips anytime from Help.",
      href: "/import",
      hrefLabel: "Go to Import",
    },
  ];
}
