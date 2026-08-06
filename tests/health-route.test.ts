import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as healthGet } from "@/app/api/health/route";
import { expectedColumns, SCHEMA_CHECKS } from "@/lib/db/schema-expectations";

const pg = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn() }));

vi.mock("pg", () => ({
  Client: class {
    connect = pg.connect;
    query = pg.query;
    end = pg.end;
  },
}));

vi.mock("@/lib/ai/health", () => ({
  getAiHealth: vi.fn(async () => ({ defaultProvider: null, providers: [] })),
}));
vi.mock("@/lib/notifications/email-health", () => ({
  getEmailHealth: vi.fn(async () => ({
    configured: true,
    apiKeyPresent: true,
    apiKeyEnvVar: "RESEND_API_KEY",
    fromPresent: true,
    fromEnvVar: "EMAIL_FROM",
  })),
}));

/** Every table and column the deployed code expects, so schema drift is not what fails. */
const CURRENT_SCHEMA = {
  tables: SCHEMA_CHECKS.map((check) => ({ table_name: check.table })),
  columns: SCHEMA_CHECKS.flatMap((check) =>
    check.columns.map((column) => ({ table_name: check.table, column_name: column }))
  ),
};

/**
 * Answers the health route's four queries in the order it issues them:
 * liveness, expected tables, expected columns, then the storage catalog
 * lookup (plus the bucket row when that catalog exists).
 */
function database({ storageCatalog = true, bucket = true } = {}) {
  return vi.fn(async (sql: string) => {
    if (sql.includes("SELECT 1")) return { rows: [], rowCount: 0 };
    if (sql.includes("information_schema.tables")) {
      return { rows: CURRENT_SCHEMA.tables, rowCount: CURRENT_SCHEMA.tables.length };
    }
    if (sql.includes("information_schema.columns")) {
      return { rows: CURRENT_SCHEMA.columns, rowCount: CURRENT_SCHEMA.columns.length };
    }
    if (sql.includes("to_regclass")) {
      return { rows: [{ present: storageCatalog ? "storage.buckets" : null }], rowCount: 1 };
    }
    if (sql.includes("storage.buckets")) {
      return bucket
        ? { rows: [{ id: "invoices" }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
}

function request(url = "http://localhost/api/health"): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  pg.connect.mockResolvedValue(undefined);
  pg.end.mockResolvedValue(undefined);
  pg.query.mockImplementation(database());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ------------------------------------------------------------------ */
/* Storage on Supabase                                                 */
/* ------------------------------------------------------------------ */

describe("the storage probe against Supabase", () => {
  it("reports the private invoice bucket as up", async () => {
    const response = await healthGet(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", db: "up", storage: "up", schema: "ok" });
    expect(body.storageNote).toBeUndefined();
  });

  it("still degrades when the bucket is missing from a Supabase database", async () => {
    pg.query.mockImplementation(database({ bucket: false }));

    const response = await healthGet(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "degraded", db: "up", storage: "down" });
  });

  it("degrades when the catalog exists but cannot be read", async () => {
    pg.query.mockImplementation(async (sql: string) => {
      if (sql.includes("storage.buckets") && !sql.includes("to_regclass")) {
        throw Object.assign(new Error("permission denied for schema storage"), { code: "42501" });
      }
      return database()(sql);
    });

    const response = await healthGet(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ db: "up", storage: "down" });
  });
});

/* ------------------------------------------------------------------ */
/* Storage on a self-hosted Postgres                                   */
/* ------------------------------------------------------------------ */

describe("the storage probe against a non-Supabase Postgres", () => {
  beforeEach(() => {
    pg.query.mockImplementation(database({ storageCatalog: false }));
  });

  it("stays healthy: no storage catalog is a deployment shape, not a failure", async () => {
    const response = await healthGet(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.storage).toBe("not_applicable");
    expect(body.storageNote).toContain("Supabase");
  });

  it("never asks storage.buckets for the bucket row", async () => {
    await healthGet(request());

    const bucketLookups = pg.query.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("FROM storage.buckets")
    );
    expect(bucketLookups).toHaveLength(0);
  });

  it("still degrades on schema drift, so the escape hatch is storage-only", async () => {
    pg.query.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return {
          rows: CURRENT_SCHEMA.columns.filter((row) => row.column_name !== expectedColumns()[0]),
          rowCount: 0,
        };
      }
      return database({ storageCatalog: false })(sql);
    });

    const response = await healthGet(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ status: "degraded", storage: "not_applicable", schema: "outdated" });
    expect(body.pendingMigrations.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Email reporting                                                     */
/* ------------------------------------------------------------------ */

describe("the email section of the health payload", () => {
  it("is reported on both the healthy and the degraded path", async () => {
    expect((await (await healthGet(request())).json()).email).toMatchObject({ configured: true });

    pg.connect.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const degraded = await healthGet(request());
    expect(degraded.status).toBe(503);
    expect((await degraded.json()).email).toMatchObject({ configured: true });
  });

  it("refuses an unauthenticated probe instead of calling Resend", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-token");
    const body = await (await healthGet(request("http://localhost/api/health?probe=email"))).json();

    expect(body.emailProbe).toContain("unauthorized");
  });
});
