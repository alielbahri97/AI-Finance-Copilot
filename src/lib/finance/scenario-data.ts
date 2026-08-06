import "server-only";

import type { Assumption } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { loadForecastInputs, mapAssumptionRow } from "./data";
import { computeForecast } from "./forecast";
import {
  assumptionsInScenario,
  BASE_SCENARIO_ID,
  BASE_SCENARIO_NAME,
  toScenarioColumn,
  type ComparedScenario,
  type ScenarioSummary,
} from "./scenarios";

/**
 * Data access for named forecast scenarios. The maths lives in `scenarios.ts`
 * (pure, and therefore tested directly); this file only reads rows and hands
 * them to the untouched forecast engine.
 */

export interface ScenarioWorkspaceData {
  /** Every scenario the switcher offers, base scenario first. */
  scenarios: ScenarioSummary[];
  /** Every assumption in the workspace, across all scenarios. */
  assumptions: Assumption[];
}

/**
 * The scenarios and the assumptions in one pass. Assumptions are loaded whole
 * rather than per scenario: a workspace has tens of them, and holding them in
 * memory means the switcher can show a count next to every name and the
 * comparison can slice them without going back to the database.
 */
export async function loadScenarioData(workspaceId: string): Promise<ScenarioWorkspaceData> {
  const [rows, assumptions] = await Promise.all([
    prisma.scenario.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, isDefault: true },
    }),
    prisma.assumption.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
  ]);

  const count = (id: string | null) => {
    const inScenario = assumptionsInScenario(assumptions, id);
    return {
      assumptionCount: inScenario.length,
      enabledAssumptionCount: inScenario.filter((row) => row.enabled).length,
    };
  };

  // The base scenario is not a row, so it is prepended here. It is the default
  // unless a named scenario claims that flag.
  const named: ScenarioSummary[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    ...count(row.id),
  }));

  return {
    scenarios: [
      {
        id: BASE_SCENARIO_ID,
        name: BASE_SCENARIO_NAME,
        isDefault: !named.some((scenario) => scenario.isDefault),
        ...count(null),
      },
      ...named,
    ],
    assumptions,
  };
}

/**
 * Runs the forecast once per scenario over one shared load of history. The
 * engine is called exactly as it always was — the only difference between two
 * entries in the result is which assumptions were handed in.
 */
export async function buildScenarioForecasts(
  workspaceId: string,
  currency: string,
  ids: string[],
  data: ScenarioWorkspaceData
): Promise<ComparedScenario[]> {
  const base = await loadForecastInputs(workspaceId, currency);

  return ids.map((id) => {
    const scenario = data.scenarios.find((entry) => entry.id === id);
    return {
      id,
      name: scenario?.name ?? BASE_SCENARIO_NAME,
      forecast: computeForecast({
        ...base,
        assumptions: assumptionsInScenario(data.assumptions, id).map(mapAssumptionRow),
      }),
    };
  });
}

/**
 * Confirms a scenario id belongs to this workspace, returning the value to
 * store in `Assumption.scenarioId`. `null` (the base scenario) always belongs;
 * anything else has to be looked up, because an id arriving in a request body
 * is attacker-controlled and could name another workspace's scenario.
 */
export async function resolveScenarioColumn(
  workspaceId: string,
  id: string | null | undefined
): Promise<{ ok: true; scenarioId: string | null } | { ok: false }> {
  const column = toScenarioColumn(id);
  if (column === null) return { ok: true, scenarioId: null };

  const scenario = await prisma.scenario.findFirst({
    where: { id: column, workspaceId },
    select: { id: true },
  });
  return scenario ? { ok: true, scenarioId: scenario.id } : { ok: false };
}
