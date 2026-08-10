import { NextResponse } from "next/server";

import {
  ACCOUNT_DELETION_MAX_DURATION_SECONDS,
  runAccountDeletionSweep,
} from "@/lib/account/deletion";
import { apiError } from "@/lib/api/response";
import { logger } from "@/lib/logger";

// Next only accepts a literal here, so the run budget reads the same ceiling
// from ACCOUNT_DELETION_MAX_DURATION_SECONDS; a test asserts the two agree.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Executes account deletions whose seven-day grace period has expired, driven
 * by Vercel Cron in production (see vercel.json). Protected by the same
 * CRON_SECRET bearer token as the other sweeps.
 *
 * Daily is fast enough: the grace period is measured in days, and a request
 * that misses a run is picked up by the next one. The sweep keeps a reserve of
 * its invocation ceiling so it never starts an account it cannot finish.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.warn("[account-deletions] CRON_SECRET is not set; refusing to run.");
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const stats = await runAccountDeletionSweep({ startedAt });
    logger.info("cron_account_deletions_completed", {
      route: "/api/cron/account-deletions",
      durationMs: Date.now() - startedAt,
      maxDurationSeconds: ACCOUNT_DELETION_MAX_DURATION_SECONDS,
      ...stats,
    });
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    return apiError("GET /api/cron/account-deletions", "Cron run failed", error, {
      durationMs: Date.now() - startedAt,
    });
  }
}
