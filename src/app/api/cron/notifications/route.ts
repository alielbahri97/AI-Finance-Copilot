import { NextResponse } from "next/server";

import { runNotificationCron } from "@/lib/notifications/cron";

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
    console.error("[notifications] CRON_SECRET is not set; refusing to run.");
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stats = await runNotificationCron();
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    console.error("GET /api/cron/notifications failed:", error);
    return NextResponse.json({ error: "Cron run failed" }, { status: 500 });
  }
}
