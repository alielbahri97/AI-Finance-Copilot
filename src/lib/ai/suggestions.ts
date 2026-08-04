import { DEFAULT_EDITION, type Edition } from "@/lib/branding";

import type { FinancialSnapshot } from "./context";

/**
 * Contextual starter questions built from the user's actual data, in priority
 * order; the UI shows the first few as chips.
 *
 * The same signals drive both editions — an expense jump is an expense jump —
 * but the wording differs, because "which suppliers cost the most?" is not a
 * question anyone asks about their own household.
 */
export function buildSuggestedQuestions(
  snapshot: FinancialSnapshot,
  edition: Edition = DEFAULT_EDITION
): string[] {
  const personal = edition === "personal";
  const suggestions: string[] = [];

  const fullMonths = snapshot.months.filter(
    (month) => !month.partial && (month.income > 0 || month.expenses > 0)
  );
  const last = fullMonths[fullMonths.length - 1];
  const previous = fullMonths[fullMonths.length - 2];

  // Expense jump month-over-month.
  if (last && previous && previous.expenses > 0 && last.expenses > previous.expenses * 1.15) {
    const month = last.label.split(" ")[0];
    suggestions.push(
      personal ? `Why did I spend more in ${month}?` : `Why did my expenses jump in ${month}?`
    );
  }

  // Where the money went — the single most-asked personal question.
  if (personal && last) {
    suggestions.push("Where did my money go this month?");
  }

  // Cash direction.
  const recentNet = fullMonths.slice(-3).reduce((sum, month) => sum + month.net, 0);
  if (fullMonths.length >= 2 && recentNet < 0) {
    suggestions.push(personal ? "Why is my balance going down?" : "Why is my cash decreasing?");
  }

  // Top counterparty.
  const topCounterparty = snapshot.topCounterparties[0];
  if (topCounterparty) {
    suggestions.push(`How much am I spending with ${topCounterparty.name}?`);
    if (!personal) suggestions.push("Which suppliers cost the most?");
  }

  // Recurring payments, which for an individual are mostly subscriptions.
  if (personal && snapshot.recurring.length > 0) {
    suggestions.push("Which subscriptions am I paying for?");
  }

  // Anomalies.
  if (snapshot.unusual.length > 0) {
    suggestions.push("Any unusual transactions I should look at?");
  }

  // Runway and forecast.
  if (snapshot.forecast.metrics.runwayMonths !== null) {
    suggestions.push(
      personal ? "How long would my savings last?" : "How long is my cash runway?"
    );
  }
  suggestions.push(
    personal
      ? "What will my balance look like in 3 months?"
      : "Predict my cash for the next 3 months."
  );

  // Top category.
  const topCategory = snapshot.categorySpend[0];
  if (topCategory && topCategory.name !== "Uncategorized") {
    suggestions.push(
      personal
        ? `How much do I spend on ${topCategory.name.toLowerCase()}?`
        : `How can I reduce my ${topCategory.name} spending?`
    );
  }

  // Evergreen fallbacks.
  if (personal) {
    suggestions.push(
      "Can I afford a €2,000 holiday this year?",
      "What are my largest expenses?",
      "Where can I cut back without it hurting?",
      "How much am I actually saving each month?"
    );
  } else {
    suggestions.push(
      "What are my largest expenses?",
      "Where can I cut spending with the least pain?",
      "How healthy is my savings rate?"
    );
  }

  // De-duplicate while preserving order.
  return [...new Set(suggestions)];
}
