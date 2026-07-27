import { NextResponse } from "next/server";

import { runDueSyncs } from "@/lib/integrations/sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Scheduled integration synchronization, driven by Vercel Cron (hourly, see
 * vercel.json). Each connection syncs when its provider interval (with
 * failure backoff) has elapsed; failures are isolated per connection and
 * recorded on SyncRun — the cron itself never crashes on a provider error.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[integrations] CRON_SECRET is not set; refusing to run.");
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stats = await runDueSyncs();
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    console.error("GET /api/cron/sync failed:", error);
    return NextResponse.json({ error: "Cron run failed" }, { status: 500 });
  }
}
