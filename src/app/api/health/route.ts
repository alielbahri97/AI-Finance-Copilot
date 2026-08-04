import { NextResponse } from "next/server";
import { Client } from "pg";

import {
  expectedColumns,
  expectedTables,
  findSchemaDrift,
  isSchemaUpToDate,
  type SchemaDrift,
} from "@/lib/db/schema-expectations";
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
 * Two catalog lookups (index-backed, sub-millisecond) telling us whether the
 * database has everything the deployed code queries. Catches the window where
 * Vercel has shipped new code but the migrations have not been applied yet.
 */
async function checkSchema(client: Client): Promise<SchemaDrift> {
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [expectedTables()]
  );

  const columns = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
        AND column_name = ANY($2::text[])`,
    [expectedTables(), expectedColumns()]
  );

  return findSchemaDrift(
    tables.rows.map((row) => row.table_name),
    columns.rows.map((row) => `${row.table_name}.${row.column_name}`)
  );
}

/**
 * Liveness/readiness probe for load balancers and uptime monitors.
 * Uses a short-lived dedicated Client (not the shared Prisma pool) so the
 * check never holds pooled connections open. Verifies DB connectivity, that
 * the schema matches the deployed code, and that the private `invoices`
 * Storage bucket exists. Unauthenticated by design — exposes only up/down
 * status fields and the names of missing tables/columns (no secrets).
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
  let drift: SchemaDrift | undefined;

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

        drift = await checkSchema(client);
        if (!isSchemaUpToDate(drift)) {
          logger.error("health_schema_outdated", {
            missingTables: drift.missingTables,
            missingColumns: drift.missingColumns,
            pendingMigrations: drift.pendingMigrations,
          });
        }

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
  // Unknown when the connection failed before the catalog lookups ran.
  const schemaOk = drift ? isSchemaUpToDate(drift) : false;
  const schema = !drift ? "unknown" : schemaOk ? "ok" : "outdated";
  const ok = status.db && status.storage && schemaOk;

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db,
      storage,
      schema,
      ...(!status.db && reason ? { reason } : {}),
      ...(drift && !schemaOk
        ? {
            missingTables: drift.missingTables,
            missingColumns: drift.missingColumns,
            pendingMigrations: drift.pendingMigrations,
            hint: "Run `npm run db:apply` against production to apply pending migrations.",
          }
        : {}),
      latencyMs: Date.now() - startedAt,
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
