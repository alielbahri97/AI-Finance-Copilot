import type { AssumptionInput, ForecastResult } from "./forecast";

function money(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** One-line human description of an assumption, used in prompts and the AI snapshot. */
export function describeAssumption(assumption: AssumptionInput): string {
  const side = assumption.type === "INCOME" ? "income" : "expense";
  const status = assumption.enabled ? "" : " [disabled]";
  if (assumption.kind === "ONE_OFF") {
    return `${assumption.label}: one-off ${side} of ${money(assumption.amount ?? 0)} on ${assumption.date ? isoDay(assumption.date) : "?"}${status}`;
  }
  if (assumption.kind === "RECURRING") {
    const window = [
      assumption.startDate ? `from ${isoDay(assumption.startDate)}` : null,
      assumption.endDate ? `until ${isoDay(assumption.endDate)}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return `${assumption.label}: recurring ${side} of ${money(assumption.amount ?? 0)}/month${window ? ` ${window}` : ""}${status}`;
  }
  return `${assumption.label}: ${assumption.percent ?? 0}% ${side} growth per month (compounding)${status}`;
}

/**
 * Compact plain-text rendering of the forecast for AI prompts (the copilot
 * snapshot and the "explain this forecast" feature).
 */
export function renderForecastText(
  forecast: ForecastResult,
  assumptions: AssumptionInput[]
): string {
  const lines: string[] = [];
  const m = forecast.metrics;

  lines.push(
    `Current balance: ${money(forecast.currentBalance)} ${forecast.currency} (as of ${forecast.generatedAt})`
  );
  lines.push(
    `Burn (avg of last 3 full months): gross expenses ${money(m.grossBurnRate)}/mo, income ${money(m.avgMonthlyIncome)}/mo, net ${m.netBurnRate > 0 ? `burning ${money(m.netBurnRate)}/mo` : `adding ${money(Math.abs(m.netBurnRate))}/mo`}`
  );
  lines.push(
    `Cash runway: ${m.runwayMonths === null ? "infinite (projected cash-flow positive)" : `~${m.runwayMonths} months until cash reaches zero`}`
  );
  lines.push(
    `Projected balance: 30 days ${money(m.projectedBalance30d)}, 90 days ${money(m.projectedBalance90d)}, 12 months ${money(m.projectedBalance12m)}`
  );
  lines.push(
    `Recurring flows detected: income ${money(m.recurringMonthlyIncome)}/mo, expenses ${money(m.recurringMonthlyExpenses)}/mo`
  );

  const monthlyPoints = forecast.horizons.m12.filter((point) => point.projected !== null);
  if (monthlyPoints.length > 0) {
    lines.push("", "PROJECTED MONTH-END BALANCES (with ~80% confidence band):");
    for (const point of monthlyPoints) {
      const band = point.band ? ` (band ${money(point.band[0])} to ${money(point.band[1])})` : "";
      lines.push(`${point.date}: ${money(point.projected ?? 0)}${band}`);
    }
  }

  if (forecast.recurringExpenses.length > 0) {
    lines.push("", "RECURRING EXPENSES:");
    for (const item of forecast.recurringExpenses.slice(0, 12)) {
      lines.push(
        `${item.label} (${item.category}): ~${money(item.averageAmount)} ${item.cadence} = ${money(item.monthlyAmount)}/mo, seen ${item.timesSeen}x, last on ${item.lastDate}`
      );
    }
  }

  if (forecast.recurringIncome.length > 0) {
    lines.push("", "RECURRING INCOME:");
    for (const item of forecast.recurringIncome.slice(0, 8)) {
      lines.push(
        `${item.label} (${item.category}): ~${money(item.averageAmount)} ${item.cadence} = ${money(item.monthlyAmount)}/mo, last on ${item.lastDate}`
      );
    }
  }

  if (forecast.upcomingBills.length > 0) {
    lines.push("", "UPCOMING BILLS (next 45 days):");
    for (const bill of forecast.upcomingBills) {
      lines.push(
        `${bill.dueDate}: ${money(bill.amount)} ${bill.label}${bill.source === "assumption" ? " (user assumption)" : ""}`
      );
    }
  }

  lines.push("", "USER ASSUMPTIONS APPLIED TO THE FORECAST:");
  if (assumptions.length === 0) {
    lines.push("none");
  } else {
    for (const assumption of assumptions) {
      lines.push(describeAssumption(assumption));
    }
  }

  lines.push(
    "",
    "METHOD: recurring items scheduled at their detected cadence + linear trend on the non-recurring remainder (last 6 full months) + user assumptions; band = ±1.28σ of historical monthly net, widening with √time."
  );

  return lines.join("\n");
}
