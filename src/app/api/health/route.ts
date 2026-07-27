import { NextResponse } from "next/server";

import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for load balancers and uptime monitors.
 * Verifies database connectivity; returns 503 when the DB is unreachable.
 * Unauthenticated by design — it exposes no data beyond up/down status.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      db: "up",
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error("health_check_failed", { error: serializeError(error) });
    return NextResponse.json(
      { status: "degraded", db: "down" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
