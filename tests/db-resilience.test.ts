import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findSchemaDrift,
  isSchemaUpToDate,
  expectedColumns,
  expectedTables,
  SCHEMA_CHECKS,
  type SchemaCheck,
} from "@/lib/db/schema-expectations";
import {
  classifyDatabaseFailure,
  describeDatabaseError,
  isDatabaseUnavailable,
  isSchemaOutOfDate,
} from "@/lib/db-errors";

/** Builds an error shaped like the ones pg / Prisma actually throw. */
function dbError(message: string, code?: string, name = "Error"): Error {
  const error = new Error(message) as Error & { code?: string };
  error.name = name;
  if (code) error.code = code;
  return error;
}

/* ------------------------------------------------------------------ */
/* Schema drift vs connectivity                                        */
/* ------------------------------------------------------------------ */

describe("schema-drift classification", () => {
  it("recognizes Prisma's missing table/column/FK codes", () => {
    for (const code of ["P2021", "P2022", "P2003"]) {
      const error = dbError("query failed", code, "PrismaClientKnownRequestError");
      expect(isSchemaOutOfDate(error)).toBe(true);
      expect(classifyDatabaseFailure(error)).toBe("schema_outdated");
    }
  });

  it("recognizes raw Postgres SQLSTATEs for undefined objects", () => {
    for (const code of ["42P01", "42703", "42704", "42883", "42P10"]) {
      expect(isSchemaOutOfDate(dbError("boom", code))).toBe(true);
    }
  });

  it("falls back to the message when no code survives the driver", () => {
    expect(
      isSchemaOutOfDate(
        dbError("The table `public.workspace_members` does not exist in the current database.")
      )
    ).toBe(true);
    expect(isSchemaOutOfDate(dbError('relation "workspaces" does not exist'))).toBe(true);
    expect(isSchemaOutOfDate(dbError('column "workspace_id" does not exist'))).toBe(true);
    // Writing an enum member a pending migration was supposed to add.
    expect(
      isSchemaOutOfDate(dbError('invalid input value for enum "NotificationType": "WORKSPACE"'))
    ).toBe(true);
  });

  it("reads the SQLSTATE out of a wrapped adapter error", () => {
    const wrapper = new Error("Invalid `prisma.workspaceMember.findUnique()` invocation", {
      cause: dbError('relation "workspace_members" does not exist', "42P01"),
    });
    expect(isSchemaOutOfDate(wrapper)).toBe(true);
    expect(classifyDatabaseFailure(wrapper)).toBe("schema_outdated");
  });

  it("does not mistake drift for an outage — retrying would never help", () => {
    const error = dbError("query failed", "P2021", "PrismaClientKnownRequestError");
    expect(isDatabaseUnavailable(error)).toBe(false);
  });

  it("still classifies real connectivity failures as outages", () => {
    for (const code of ["P1001", "ECONNREFUSED", "ETIMEDOUT", "53300"]) {
      const error = dbError("connection failed", code);
      expect(classifyDatabaseFailure(error)).toBe("unavailable");
      expect(isSchemaOutOfDate(error)).toBe(false);
    }
    expect(classifyDatabaseFailure(dbError("Connection terminated unexpectedly"))).toBe(
      "unavailable"
    );
  });

  it("leaves ordinary bugs unclassified so they reach the error boundary", () => {
    expect(classifyDatabaseFailure(dbError("Cannot read properties of undefined"))).toBeNull();
    expect(classifyDatabaseFailure(dbError("Unique constraint failed", "P2002"))).toBeNull();
    expect(classifyDatabaseFailure(null)).toBeNull();
  });

  it("keeps connection strings out of the reported message", () => {
    const described = describeDatabaseError(
      dbError("can't reach postgresql://postgres.abc:sup3rsecret@aws-0.pooler.supabase.com:6543/db")
    );
    expect(described.message).not.toContain("sup3rsecret");
    expect(described.message).toContain("postgresql://***");
  });
});

/* ------------------------------------------------------------------ */
/* Schema expectations                                                 */
/* ------------------------------------------------------------------ */

describe("schema expectations", () => {
  const checks: SchemaCheck[] = [
    { table: "workspaces", columns: [], migration: "0014_workspaces" },
    { table: "transactions", columns: ["workspace_id"], migration: "0014_workspaces" },
    { table: "invoices", columns: ["extraction_provider"], migration: "0015_extraction_telemetry" },
  ];

  it("reports no drift when everything is present", () => {
    const drift = findSchemaDrift(
      ["workspaces", "transactions", "invoices"],
      ["transactions.workspace_id", "invoices.extraction_provider"],
      checks
    );
    expect(drift).toEqual({ missingTables: [], missingColumns: [], pendingMigrations: [] });
    expect(isSchemaUpToDate(drift)).toBe(true);
  });

  it("names missing tables and the migration that supplies them", () => {
    const drift = findSchemaDrift(
      ["transactions", "invoices"],
      ["transactions.workspace_id", "invoices.extraction_provider"],
      checks
    );
    expect(drift.missingTables).toEqual(["workspaces"]);
    expect(drift.pendingMigrations).toEqual(["0014_workspaces"]);
    expect(isSchemaUpToDate(drift)).toBe(false);
  });

  it("names missing columns on tables that do exist", () => {
    const drift = findSchemaDrift(["workspaces", "transactions", "invoices"], [], checks);
    expect(drift.missingColumns).toEqual([
      "transactions.workspace_id",
      "invoices.extraction_provider",
    ]);
    expect(drift.pendingMigrations).toEqual(["0014_workspaces", "0015_extraction_telemetry"]);
  });

  it("does not list columns of an absent table twice", () => {
    const drift = findSchemaDrift([], [], checks);
    expect(drift.missingTables).toEqual(["workspaces", "transactions", "invoices"]);
    expect(drift.missingColumns).toEqual([]);
  });

  it("derives deduplicated query parameters from the real check list", () => {
    // `invoices` is checked by two migrations; it must be requested once.
    expect(expectedTables()).toEqual([...new Set(expectedTables())]);
    expect(expectedColumns()).toEqual([...new Set(expectedColumns())]);
    expect(expectedTables()).toContain("workspace_members");
    expect(expectedColumns()).toContain("workspace_id");
  });

  it("covers the migrations that shipped ahead of production", () => {
    const migrations = new Set(SCHEMA_CHECKS.map((check) => check.migration));
    expect(migrations).toContain("0013_help_messages");
    expect(migrations).toContain("0014_workspaces");
    expect(migrations).toContain("0015_extraction_telemetry");
    expect(migrations).toContain("0016_multi_bank_connections");
    expect(migrations).toContain("0017_workspace_editions");
    expect(migrations).toContain("0018_ai_categorization");
    expect(migrations).toContain("0019_customer_dunning");
    expect(migrations).toContain("0020_net_worth");
  });

  it("names real migrations, and every one from the oldest it names onwards", () => {
    const covered = new Set(SCHEMA_CHECKS.map((check) => check.migration));
    const directories = readdirSync(join(__dirname, "..", "prisma", "migrations"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect([...covered].filter((migration) => !directories.includes(migration))).toEqual([]);

    // The list starts at 0013 by design, so the cut-off is the oldest migration
    // it names rather than 0001. Past that point a gap means /api/health would
    // report `ok` for a schema the deployed code has already moved past.
    const cutoff = [...covered].sort()[0];
    expect(directories.filter((name) => name >= cutoff && !covered.has(name))).toEqual([]);
  });
});
