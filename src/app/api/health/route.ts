import { NextResponse } from "next/server";
import { Client } from "pg";

import { describeDatabaseError } from "@/lib/db-errors";
import { INVOICE_BUCKET } from "@/lib/invoices/storage";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const HEALTH_TIMEOUT_MS = 4_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`health check timed out after ${ms}ms`);
          (err as Error & { code: string }).code = "ETIMEDOUT";
          reject(err);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Liveness/readiness probe for load balancers and uptime monitors.
 * Uses a short-lived dedicated Client (not the shared Prisma pool) so the
 * check never holds pooled connections open. Verifies DB connectivity and
 * that the private `invoices` Storage bucket exists. Unauthenticated by
 * design — exposes only up/down status fields (no secrets).
 */
export async function GET() {
  const startedAt = Date.now();
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    logger.error("health_check_failed", {
      reason: "DATABASE_URL_missing",
      latencyMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        status: "degraded",
        db: "down",
        storage: "down",
        reason: "misconfigured",
        latencyMs: Date.now() - startedAt,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const status = { db: false, storage: false };
  let reason: string | undefined;

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: HEALTH_TIMEOUT_MS,
  });

  try {
    await withTimeout(
      (async () => {
        await client.connect();
        await client.query("SELECT 1");
        status.db = true;

        // Parameterized id; public=false matches README §5 setup.
        const rows = await client.query<{ id: string }>(
          `SELECT id
           FROM storage.buckets
           WHERE id = $1
             AND public = false
           LIMIT 1`,
          [INVOICE_BUCKET]
        );
        status.storage = (rows.rowCount ?? 0) > 0;
        if (!status.storage) {
          logger.error("health_storage_bucket_missing", { bucket: INVOICE_BUCKET });
        }
      })(),
      HEALTH_TIMEOUT_MS
    );
  } catch (error) {
    const detail = describeDatabaseError(error);
    reason = detail.code ?? detail.name;
    logger.error("health_check_failed", {
      error: detail,
      db: status.db ? "up" : "down",
      storage: status.storage ? "up" : "down",
      latencyMs: Date.now() - startedAt,
    });
    if (status.db && !status.storage) {
      logger.error("health_storage_check_failed", { error: detail });
    }
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore disconnect errors — the probe already failed or succeeded.
    }
  }

  const db = status.db ? "up" : "down";
  const storage = status.storage ? "up" : "down";
  const ok = status.db && status.storage;

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db,
      storage,
      ...(!status.db && reason ? { reason } : {}),
      latencyMs: Date.now() - startedAt,
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
