import type { FinancialSnapshot } from "./context";

/**
 * Builds contextual starter questions from the user's actual data. Returned in
 * priority order; the UI shows the first few as chips.
 */
export function buildSuggestedQuestions(snapshot: FinancialSnapshot): string[] {
  const suggestions: string[] = [];
  const fullMonths = snapshot.months.filter(
    (month) => !month.partial && (month.income > 0 || month.expenses > 0)
  );
  const last = fullMonths[fullMonths.length - 1];
  const previous = fullMonths[fullMonths.length - 2];

  // Expense jump month-over-month.
  if (last && previous && previous.expenses > 0 && last.expenses > previous.expenses * 1.15) {
    suggestions.push(`Why did my expenses jump in ${last.label.split(" ")[0]}?`);
  }

  // Cash direction.
  const recentNet = fullMonths.slice(-3).reduce((sum, month) => sum + month.net, 0);
  if (fullMonths.length >= 2 && recentNet < 0) {
    suggestions.push("Why is my cash decreasing?");
  }

  // Top supplier.
  const topSupplier = snapshot.topCounterparties[0];
  if (topSupplier) {
    suggestions.push(`How much am I spending with ${topSupplier.name}?`);
    suggestions.push("Which suppliers cost the most?");
  }

  // Anomalies.
  if (snapshot.unusual.length > 0) {
    suggestions.push("Any unusual transactions I should look at?");
  }

  // Runway and forecast.
  if (snapshot.forecast.metrics.runwayMonths !== null) {
    suggestions.push("How long is my cash runway?");
  }
  suggestions.push("Predict my cash for the next 3 months.");

  // Top category.
  const topCategory = snapshot.categorySpend[0];
  if (topCategory && topCategory.name !== "Uncategorized") {
    suggestions.push(`How can I reduce my ${topCategory.name} spending?`);
  }

  // Evergreen fallbacks.
  suggestions.push(
    "What are my largest expenses?",
    "Where can I cut spending with the least pain?",
    "How healthy is my savings rate?"
  );

  // De-duplicate while preserving order.
  return [...new Set(suggestions)];
}
