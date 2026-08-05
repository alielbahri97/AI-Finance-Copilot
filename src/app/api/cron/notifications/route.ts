import { NextResponse } from "next/server";

import { runNotificationCron } from "@/lib/notifications/cron";
import { apiError } from "@/lib/api/response";
import { runAutoDunning } from "@/lib/invoices/dunning";
import { logger } from "@/lib/logger";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Scheduled notification evaluation, driven by Vercel Cron in production
 * (see vercel.json). Protected by a CRON_SECRET bearer token; Vercel sends
 * `Authorization: Bearer $CRON_SECRET` automatically for cron invocations.
 * Idempotent: last-sent timestamps prevent duplicate sends across re-runs.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.warn("[notifications] CRON_SECRET is not set; refusing to run.");
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const stats = await runNotificationCron();
    // Customer-facing reminders ride the same hourly tick but are evaluated
    // per workspace rather than per member, so they run as their own pass
    // instead of inside the per-user loop. Idempotent either way: eligibility
    // is a function of the due date and the reminder log.
    const dunning = await runAutoDunning();
    logger.info("cron_notifications_completed", {
      route: "/api/cron/notifications",
      durationMs: Date.now() - startedAt,
      ...stats,
      customerRemindersSent: dunning.sent,
    });
    return NextResponse.json({ ok: true, stats, dunning });
  } catch (error) {
    return apiError("GET /api/cron/notifications", "Cron run failed", error, {
      durationMs: Date.now() - startedAt,
    });
  }
}
