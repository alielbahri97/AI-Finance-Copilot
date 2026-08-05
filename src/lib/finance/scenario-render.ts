import type { AssumptionInput } from "./forecast";
import { describeAssumption, renderForecastText } from "./render";
import { scenarioDeltas, type ComparedScenario } from "./scenarios";

/**
 * Plain-text rendering of a scenario comparison for AI prompts.
 *
 * The primary scenario is rendered in full (the same block the single-scenario
 * explanation uses, so the model's grounding does not change shape), and every
 * other scenario is rendered as what differs: its assumptions, its metrics and
 * the gap to the primary. That framing is deliberate — the question a
 * comparison asks is never "what does scenario B look like" but "why is B
 * different, and which assumption did it".
 */

export interface ScenarioForPrompt extends ComparedScenario {
  assumptions: AssumptionInput[];
}

function money(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function runway(months: number | null): string {
  return months === null ? "infinite (projected cash-flow positive)" : `~${months} months`;
}

function signed(value: number): string {
  if (value === 0) return "no change";
  return `${value > 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

export function renderScenarioComparisonText(scenarios: ScenarioForPrompt[]): string {
  const primary = scenarios[0];
  if (!primary) return "";

  const deltas = scenarioDeltas(scenarios);
  const lines: string[] = [
    `PRIMARY SCENARIO: ${primary.name}`,
    renderForecastText(primary.forecast, primary.assumptions),
  ];

  for (let index = 1; index < scenarios.length; index++) {
    const entry = scenarios[index];
    const delta = deltas[index];
    const m = entry.forecast.metrics;
    lines.push(
      "",
      `COMPARED SCENARIO: ${entry.name}`,
      `Projected balance: 30 days ${money(m.projectedBalance30d)} (${signed(delta.delta30d)} vs ${primary.name}), 90 days ${money(m.projectedBalance90d)} (${signed(delta.delta90d)}), 12 months ${money(m.projectedBalance12m)} (${signed(delta.delta12m)})`,
      `Cash runway: ${runway(m.runwayMonths)}${
        delta.runwayDeltaMonths === null
          ? ""
          : ` (${delta.runwayDeltaMonths > 0 ? "+" : ""}${delta.runwayDeltaMonths} months vs ${primary.name})`
      }`,
      `Active assumptions: ${entry.forecast.activeAssumptions}`,
      "ASSUMPTIONS IN THIS SCENARIO:"
    );
    if (entry.assumptions.length === 0) {
      lines.push("none");
    } else {
      for (const assumption of entry.assumptions) lines.push(describeAssumption(assumption));
    }
  }

  lines.push(
    "",
    "NOTE: every scenario above was computed from the same transaction history with the same method; the only difference between them is the assumptions listed under each."
  );

  return lines.join("\n");
}

/** The instruction block that turns the explanation into a comparison. */
export function scenarioComparisonInstructions(scenarios: ScenarioForPrompt[]): string {
  const names = scenarios.map((entry) => `"${entry.name}"`).join(" and ");
  return `The user is comparing ${scenarios.length} forecast scenarios: ${names}.

- Use Markdown with exactly three sections: "### What separates these scenarios", "### Risks and uncertainty", "### Recommendations".
- Lead with the difference, in numbers: which scenario ends ahead, by how much, and when the gap opens up. If one runs out of cash earlier, say by how many months.
- Attribute the difference to specific assumptions listed under each scenario, by label. Never guess at a cause that is not in the data.
- If two scenarios barely differ, say so plainly instead of manufacturing a distinction.
- Recommendations: 3-5 specific actions, framed as which scenario to plan for and what would have to be true.`;
}
