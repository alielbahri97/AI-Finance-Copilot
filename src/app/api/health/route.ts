import { NextResponse } from "next/server";

import { INVOICE_BUCKET } from "@/lib/invoices/storage";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for load balancers and uptime monitors.
 * Verifies database connectivity and that the private `invoices` Storage
 * bucket exists (via `storage.buckets` — no service-role key required).
 * Unauthenticated by design — exposes only up/down status fields.
 */
export async function GET() {
  const startedAt = Date.now();
  let db: "up" | "down" = "down";
  let storage: "up" | "down" = "down";

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch (error) {
    logger.error("health_check_failed", { error: serializeError(error) });
  }

  try {
    // Parameterized id keeps the query safe; public=false matches the README §5 setup.
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM storage.buckets
      WHERE id = ${INVOICE_BUCKET}
        AND public = false
      LIMIT 1
    `;
    storage = rows.length > 0 ? "up" : "down";
    if (storage === "down") {
      logger.error("health_storage_bucket_missing", { bucket: INVOICE_BUCKET });
    }
  } catch (error) {
    logger.error("health_storage_check_failed", { error: serializeError(error) });
    storage = "down";
  }

  const ok = db === "up" && storage === "up";
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db,
      storage,
      latencyMs: Date.now() - startedAt,
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
