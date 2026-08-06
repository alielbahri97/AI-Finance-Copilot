import { NextResponse } from "next/server";
import { Client } from "pg";

import { getAiHealth } from "@/lib/ai/health";
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
import { getEmailHealth } from "@/lib/notifications/email-health";

export const dynamic = "force-dynamic";

const HEALTH_TIMEOUT_MS = 4_000;

const PROBE_UNAUTHORIZED = "unauthorized — send the CRON_SECRET bearer token to run it";

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
 * Whether the private invoice bucket could be confirmed. `not_applicable` is
 * the self-hosted answer: see {@link checkStorageBucket}.
 */
type StorageStatus = "up" | "down" | "not_applicable";

const STORAGE_NOT_APPLICABLE_NOTE =
  "DATABASE_URL is not a Supabase database, so the invoice bucket cannot be " +
  "checked from SQL — verify it in the Supabase dashboard instead.";

/**
 * Confirms the private `invoices` bucket exists, when the database can answer.
 *
 * The bucket lives in Supabase Storage, whose `storage.buckets` catalog only
 * exists on a Supabase database. The Docker Compose path in this repo runs a
 * plain Postgres while auth and storage stay on Supabase, so an absent catalog
 * says nothing about the bucket and must not read as an outage.
 */
async function checkStorageBucket(client: Client): Promise<StorageStatus> {
  const catalog = await client.query<{ present: string | null }>(
    `SELECT to_regclass('storage.buckets')::text AS present`
  );
  if (!catalog.rows[0]?.present) return "not_applicable";

  // Parameterized id; public=false matches README §5 setup.
  const rows = await client.query<{ id: string }>(
    `SELECT id
       FROM storage.buckets
      WHERE id = $1
        AND public = false
      LIMIT 1`,
    [INVOICE_BUCKET]
  );
  return (rows.rowCount ?? 0) > 0 ? "up" : "down";
}

/**
 * Liveness/readiness probe for load balancers and uptime monitors.
 * Uses a short-lived dedicated Client (not the shared Prisma pool) so the
 * check never holds pooled connections open. Verifies DB connectivity, that
 * the schema matches the deployed code, that the private `invoices` Storage
 * bucket exists (where the database can be asked), and which AI
 * providers/models are configured.
 *
 * Unauthenticated by design — exposes only up/down status, the names of
 * missing tables/columns, AI model ids, and whether the email channel is
 * configured plus its sending domain (all non-secret; API keys are reported as
 * a boolean only). `?probe=ai`, `?probe=email` or `?probe=all` additionally
 * call the provider APIs and therefore require the CRON_SECRET bearer token.
 *
 * Email is optional, so its configuration is informational and never changes
 * the HTTP status.
 */
export async function GET(request: Request) {
  const startedAt = Date.now();
  const connectionString = process.env.DATABASE_URL;
  const cronSecret = process.env.CRON_SECRET;
  const probe = new URL(request.url).searchParams.get("probe");
  const aiProbeRequested = probe === "ai" || probe === "all";
  const emailProbeRequested = probe === "email" || probe === "all";
  const probeAuthorized =
    Boolean(cronSecret) && request.headers.get("authorization") === `Bearer ${cronSecret}`;
  const [ai, email] = await Promise.all([
    getAiHealth({ probe: aiProbeRequested && probeAuthorized }),
    getEmailHealth({ probe: emailProbeRequested && probeAuthorized }),
  ]);
  const probeNotes = {
    ...(aiProbeRequested && !probeAuthorized ? { aiProbe: PROBE_UNAUTHORIZED } : {}),
    ...(emailProbeRequested && !probeAuthorized ? { emailProbe: PROBE_UNAUTHORIZED } : {}),
  };

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
        ai,
        email,
        ...probeNotes,
        latencyMs: Date.now() - startedAt,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  let dbUp = false;
  let storage: StorageStatus = "down";
  let reason: string | undefined;
  let drift: SchemaDrift | undefined;

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: HEALTH_TIMEOUT_MS,
  });

  try {
    // The bucket status comes back as a return value rather than a captured
    // assignment: TypeScript cannot narrow a union written only inside a
    // closure, and would then read the checks below as unreachable.
    storage = await withTimeout(
      (async (): Promise<StorageStatus> => {
        await client.connect();
        await client.query("SELECT 1");
        dbUp = true;

        drift = await checkSchema(client);
        if (!isSchemaUpToDate(drift)) {
          logger.error("health_schema_outdated", {
            missingTables: drift.missingTables,
            missingColumns: drift.missingColumns,
            pendingMigrations: drift.pendingMigrations,
          });
        }

        const bucket = await checkStorageBucket(client);
        if (bucket === "down") {
          logger.error("health_storage_bucket_missing", { bucket: INVOICE_BUCKET });
        }
        return bucket;
      })(),
      HEALTH_TIMEOUT_MS
    );
  } catch (error) {
    const detail = describeDatabaseError(error);
    reason = detail.code ?? detail.name;
    logger.error("health_check_failed", {
      error: detail,
      db: dbUp ? "up" : "down",
      storage,
      latencyMs: Date.now() - startedAt,
    });
    if (dbUp && storage === "down") {
      logger.error("health_storage_check_failed", { error: detail });
    }
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore disconnect errors — the probe already failed or succeeded.
    }
  }

  const db = dbUp ? "up" : "down";
  // Unknown when the connection failed before the catalog lookups ran.
  const schemaOk = drift ? isSchemaUpToDate(drift) : false;
  const schema = !drift ? "unknown" : schemaOk ? "ok" : "outdated";
  const ok = dbUp && storage !== "down" && schemaOk;

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db,
      storage,
      schema,
      ai,
      // Informational: a missing email setup never degrades `status`.
      email,
      ...probeNotes,
      ...(storage === "not_applicable" ? { storageNote: STORAGE_NOT_APPLICABLE_NOTE } : {}),
      ...(!dbUp && reason ? { reason } : {}),
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
