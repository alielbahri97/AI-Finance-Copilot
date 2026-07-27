/**
 * Applies prisma/migrations/*\/migration.sql in order using a plain `pg`
 * connection — a drop-in replacement for `prisma migrate deploy` for
 * machines that cannot download Prisma's schema engine binary
 * (binaries.prisma.sh blocked).
 *
 * Behaviour is compatible with Prisma Migrate: it creates/uses the
 * standard `_prisma_migrations` bookkeeping table, skips migrations that
 * are already recorded as applied, records applied ones with a SHA-256
 * checksum, and warns when an applied migration's file was edited
 * afterwards. You can switch back to `prisma migrate deploy` at any time.
 *
 * Usage:
 *   npm run db:apply            # applies pending migrations (uses DIRECT_URL)
 *   npm run db:apply -- --dry-run   # validates and lists migrations, no DB needed
 */
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { Client } from "pg";

interface LocalMigration {
  name: string;
  sql: string;
  checksum: string;
}

interface AppliedRow {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum"            VARCHAR(64) NOT NULL,
  "finished_at"         TIMESTAMPTZ,
  "migration_name"      VARCHAR(255) NOT NULL,
  "logs"                TEXT,
  "rolled_back_at"      TIMESTAMPTZ,
  "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

function loadMigrations(): LocalMigration[] {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  if (!existsSync(dir)) {
    throw new Error(`Migrations directory not found: ${dir} (run from the repo root)`);
  }
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return names.map((name) => {
    const file = path.join(dir, name, "migration.sql");
    if (!existsSync(file)) {
      throw new Error(`Missing migration.sql in ${name}`);
    }
    const sql = readFileSync(file, "utf8");
    if (!sql.trim()) {
      throw new Error(`Empty migration.sql in ${name}`);
    }
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
}

function resolveConnectionString(): string {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url || url.includes("FILL_ME")) {
    throw new Error(
      "DIRECT_URL (or DATABASE_URL) is not set. Fill in .env first — see FIRST_RUN.md."
    );
  }
  return url;
}

function sslFor(connectionString: string) {
  const host = new URL(connectionString).hostname;
  if (host === "localhost" || host === "127.0.0.1" || connectionString.includes("sslmode=")) {
    return undefined;
  }
  // Hosted Postgres (Supabase) speaks TLS; corporate TLS interception makes
  // strict CA verification unreliable, so accept the presented chain.
  return { rejectUnauthorized: false };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-n");
  const migrations = loadMigrations();

  console.log(`Found ${migrations.length} migration(s):`);
  for (const m of migrations) {
    console.log(`  - ${m.name} (${m.sql.length} bytes, sha256 ${m.checksum.slice(0, 12)}…)`);
  }

  if (dryRun) {
    console.log("\nDry run: all migration files parsed OK. No database changes made.");
    return;
  }

  const connectionString = resolveConnectionString();
  const client = new Client({ connectionString, ssl: sslFor(connectionString) });
  await client.connect();

  try {
    await client.query(MIGRATIONS_TABLE_DDL);
    const { rows } = await client.query<AppliedRow>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`
    );
    const applied = new Map(rows.map((r) => [r.migration_name, r]));

    let appliedCount = 0;
    for (const migration of migrations) {
      const existing = applied.get(migration.name);
      if (existing) {
        if (existing.finished_at && !existing.rolled_back_at) {
          if (existing.checksum !== migration.checksum) {
            console.warn(
              `!  ${migration.name}: already applied, but the local file changed since ` +
                `(checksum mismatch). Not re-applying; review manually if intentional.`
            );
          } else {
            console.log(`=  ${migration.name}: already applied, skipping`);
          }
          continue;
        }
        throw new Error(
          `${migration.name} is recorded as failed or rolled back in _prisma_migrations. ` +
            `Fix the database manually, then either delete that row or mark it applied ` +
            `(prisma migrate resolve --applied "${migration.name}") and re-run.`
        );
      }

      process.stdout.write(`>  ${migration.name}: applying… `);
      const startedAt = new Date();
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
           VALUES ($1, $2, now(), $3, NULL, $4, 1)`,
          [randomUUID(), migration.checksum, migration.name, startedAt]
        );
        await client.query("COMMIT");
        console.log("done");
        appliedCount += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        // Record the failure the same way prisma migrate does (finished_at
        // stays NULL) so `prisma migrate resolve` can be used afterwards.
        const message = error instanceof Error ? error.message : String(error);
        await client.query(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
           VALUES ($1, $2, NULL, $3, $4, $5, 0)`,
          [randomUUID(), migration.checksum, migration.name, message, startedAt]
        );
        throw new Error(`Migration ${migration.name} failed: ${message}`);
      }
    }

    console.log(
      appliedCount > 0
        ? `\nApplied ${appliedCount} migration(s). Database is up to date.`
        : "\nNo pending migrations. Database is up to date."
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\nError: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
