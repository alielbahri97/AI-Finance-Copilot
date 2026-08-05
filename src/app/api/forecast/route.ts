import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { buildScenarioForecasts, loadScenarioData } from "@/lib/finance/scenario-data";
import {
  resolveActiveScenarioId,
  resolveComparedScenarioIds,
  scenarioDeltas,
} from "@/lib/finance/scenarios";
import { requireWorkspace } from "@/lib/workspace/context";

export const maxDuration = 60;

/**
 * Returns the full forecast, recomputed from current data on every request.
 *
 * `?scenarioId=` picks a named scenario (absent = the workspace default, which
 * for a workspace that never made one is the base scenario, i.e. exactly the
 * response this route has always returned). `?compare=id1,id2` adds up to two
 * more: the engine simply runs once per scenario over the same history, and
 * `forecast` stays the primary one so existing callers are unaffected.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace("view_reports");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const params = new URL(request.url).searchParams;
    const data = await loadScenarioData(workspace.id);
    const primaryId = resolveActiveScenarioId(params.get("scenarioId"), data.scenarios);
    const ids = resolveComparedScenarioIds(primaryId, params.get("compare"), data.scenarios);

    const compared = await buildScenarioForecasts(
      workspace.id,
      workspace.currency,
      ids,
      data
    );

    return NextResponse.json({
      forecast: compared[0].forecast,
      scenario: { id: compared[0].id, name: compared[0].name },
      scenarios: data.scenarios,
      ...(compared.length > 1
        ? {
            comparison: compared.map((entry) => ({
              id: entry.id,
              name: entry.name,
              forecast: entry.forecast,
            })),
            deltas: scenarioDeltas(compared),
          }
        : {}),
    });
  } catch (error) {
    return apiError("GET /api/forecast", "Failed to compute forecast", error);
  }
}
