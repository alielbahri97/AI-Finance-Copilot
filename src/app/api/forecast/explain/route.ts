import { NextResponse } from "next/server";

import { AiError, getAiClient, providerFromProfile, type AiChatMessage } from "@/lib/ai";
import { getOrCreateProfile } from "@/lib/data";
import { buildForecast, mapAssumptionRow } from "@/lib/finance/data";
import { renderForecastText } from "@/lib/finance/render";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { logger, serializeError } from "@/lib/logger";

export const maxDuration = 120;

/**
 * Streams a natural-language explanation of the user's cash forecast as
 * newline-delimited JSON events ({"type":"delta"|"done"|"error"}).
 */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await enforceRateLimit("ai", user.id);
    if (limited) return limited;

    const profile = await getOrCreateProfile(user);
    const [forecast, assumptionRows] = await Promise.all([
      buildForecast(user.id, profile.currency),
      prisma.assumption.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    ]);

    const assumptions = assumptionRows.map(mapAssumptionRow);

    const messages: AiChatMessage[] = [
      {
        role: "system",
        content: `You are FinPilot's forecasting analyst. You explain a deterministic cash-flow forecast to the user in plain language.

Rules:
- All amounts are in ${profile.currency}; format them with thousands separators.
- Use Markdown with exactly three sections: "### What's driving this forecast", "### Risks and uncertainty", "### Recommendations".
- Ground everything in the FORECAST DATA below; quote concrete numbers and dates. Never invent data.
- The forecast is a trend + recurring-pattern extrapolation, not a guarantee — reflect that honestly, especially where the confidence band is wide.
- Name the biggest recurring costs, the runway situation, and how the user's assumptions (if any) change the picture.
- Recommendations: 3-5 specific, prioritized actions tied to actual numbers.
- Be concise; no intro or outro outside the three sections.

FORECAST DATA
${renderForecastText(forecast, assumptions)}`,
      },
      { role: "user", content: "Explain this forecast." },
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
