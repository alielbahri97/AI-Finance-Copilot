import { NextResponse } from "next/server";

import { AiError, getAiClient, providerFromProfile, type AiChatMessage } from "@/lib/ai";
import { BRAND } from "@/lib/branding";
import { getOrCreateProfile } from "@/lib/data";
import { mapAssumptionRow } from "@/lib/finance/data";
import { renderForecastText } from "@/lib/finance/render";
import { buildScenarioForecasts, loadScenarioData } from "@/lib/finance/scenario-data";
import {
  renderScenarioComparisonText,
  scenarioComparisonInstructions,
  type ScenarioForPrompt,
} from "@/lib/finance/scenario-render";
import {
  assumptionsInScenario,
  resolveActiveScenarioId,
  resolveComparedScenarioIds,
} from "@/lib/finance/scenarios";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { logger, serializeError } from "@/lib/logger";
import { requireWorkspace } from "@/lib/workspace/context";

export const maxDuration = 120;

/**
 * Streams a natural-language explanation of the user's cash forecast as
 * newline-delimited JSON events ({"type":"delta"|"done"|"error"}).
 *
 * An optional JSON body picks the scenario (`{ scenarioId }`) and asks for a
 * comparison (`{ compare: ["id", …] }`, up to three scenarios in total). With
 * no body at all — which is what the page sent before scenarios existed — this
 * explains the default scenario exactly as it always did.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace("view_reports", "use_copilot");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const limited = await enforceRateLimit("ai", user.id);
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as {
      scenarioId?: string | null;
      compare?: string[] | string | null;
    } | null;

    const profile = await getOrCreateProfile(user);
    const data = await loadScenarioData(workspace.id);
    const primaryId = resolveActiveScenarioId(body?.scenarioId, data.scenarios);
    const ids = resolveComparedScenarioIds(primaryId, body?.compare, data.scenarios);
    const compared = await buildScenarioForecasts(
      workspace.id,
      workspace.currency,
      ids,
      data
    );

    const scenarios: ScenarioForPrompt[] = compared.map((entry) => ({
      ...entry,
      assumptions: assumptionsInScenario(data.assumptions, entry.id).map(mapAssumptionRow),
    }));
    const isComparison = scenarios.length > 1;

    const singleRules = `- Use Markdown with exactly three sections: "### What's driving this forecast", "### Risks and uncertainty", "### Recommendations".
- Name the biggest recurring costs, the runway situation, and how the user's assumptions (if any) change the picture.
- Recommendations: 3-5 specific, prioritized actions tied to actual numbers.`;

    const messages: AiChatMessage[] = [
      {
        role: "system",
        content: `You are ${BRAND.name}'s forecasting analyst. You explain a deterministic cash-flow forecast to the user in plain language.

Rules:
- All amounts are in ${workspace.currency}; format them with thousands separators.
${isComparison ? scenarioComparisonInstructions(scenarios) : singleRules}
- Ground everything in the FORECAST DATA below; quote concrete numbers and dates. Never invent data.
- The forecast is a trend + recurring-pattern extrapolation, not a guarantee — reflect that honestly, especially where the confidence band is wide.
- Be concise; no intro or outro outside the three sections.

FORECAST DATA
${
  isComparison
    ? renderScenarioComparisonText(scenarios)
    : renderForecastText(scenarios[0].forecast, scenarios[0].assumptions)
}`,
      },
      {
        role: "user",
        content: isComparison
          ? `Explain the difference between ${scenarios.map((entry) => `"${entry.name}"`).join(" and ")}, and what drives it.`
          : "Explain this forecast.",
      },
    ];

    const ai = getAiClient(providerFromProfile(profile.aiProvider));
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // Stream already closed by a client abort.
          }
        };

        try {
          for await (const delta of ai.chatStream(messages, { signal: request.signal })) {
            send({ type: "delta", text: delta });
          }
          send({ type: "done" });
        } catch (error) {
          const aborted =
            request.signal.aborted || (error instanceof Error && error.name === "AbortError");
          if (!aborted) {
            logger.error("Forecast explanation stream", { error: serializeError(error) });
            send({
              type: "error",
              message:
                error instanceof AiError ? error.message : "The explanation could not be generated.",
            });
          }
        }
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    logger.error("POST /api/forecast/explain", { error: serializeError(error) });
    if (error instanceof AiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Failed to explain forecast" }, { status: 500 });
  }
}
