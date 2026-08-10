import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { isPlayBillingConfigured } from "@/lib/billing/play/config";
import { runPlayAcknowledgementSweep } from "@/lib/billing/play/sync";
import { logger } from "@/lib/logger";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Retries Google Play acknowledgements that failed, protected by the same
 * CRON_SECRET as the other sweeps.
 *
 * Google refunds and revokes a purchase that has not been acknowledged within
 * three days, so an acknowledgement that failed at purchase time has to be
 * chased. Daily is enough given the deadline, and it is a backstop in any case:
 * the client re-presents live purchase tokens to `/api/billing/play/verify` on
 * every app resume and that path retries acknowledgement as well.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.warn("[play-acknowledge] CRON_SECRET is not set; refusing to run.");
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlayBillingConfigured()) {
    return NextResponse.json({ ok: true, skipped: "play_not_configured" });
  }

  const startedAt = Date.now();
  try {
    const stats = await runPlayAcknowledgementSweep();
    logger.info("cron_play_acknowledge_completed", {
      route: "/api/cron/play-acknowledge",
      durationMs: Date.now() - startedAt,
      ...stats,
    });
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    return apiError("GET /api/cron/play-acknowledge", "Cron run failed", error, {
      durationMs: Date.now() - startedAt,
    });
  }
}
