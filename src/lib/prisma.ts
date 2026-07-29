import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/generated/prisma/client";
import { describeDatabaseError } from "@/lib/db-errors";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

/**
 * Serverless-safe pool: one connection per isolate.
 * Default pg Pool max=10 multiplies across cold starts and exhausts
 * Supabase's transaction pooler (especially on free/small plans).
 */
function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on("error", (err) => {
    logger.error("pg_pool_idle_client_error", {
      error: describeDatabaseError(err),
    });
  });

  return pool;
}

function createPrismaClient(): PrismaClient {
  const pool = globalForPrisma.pgPool ?? createPool();
  globalForPrisma.pgPool = pool;

  const adapter = new PrismaPg(pool, {
    onPoolError: (err) => {
      logger.error("prisma_pg_pool_error", { error: describeDatabaseError(err) });
    },
    onConnectionError: (err) => {
      logger.error("prisma_pg_connection_error", {
        error: describeDatabaseError(err),
      });
    },
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Cache across hot reloads (dev) and warm serverless isolates (prod).
globalForPrisma.prisma = prisma;
