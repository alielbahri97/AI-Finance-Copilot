import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/generated/prisma/client";
import { describeDatabaseError } from "@/lib/db-errors";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Connection pool sized for Supabase Pro's dedicated transaction pooler.
 * A few connections per isolate lets Promise.all page queries actually run
 * in parallel (max=1 serialized them). Tune via env:
 *   DB_POOL_MAX               connections per serverless isolate (default 5;
 *                             set to 1 if you're back on a tiny pooler)
 *   DB_POOL_IDLE_TIMEOUT_MS   how long idle connections are kept warm
 *                             (default 30s — avoids reconnect latency between
 *                             navigations on a warm isolate)
 *   DB_CONNECT_TIMEOUT_MS     fail fast when the pooler is unreachable
 *                             (default 5s)
 */
function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString,
    max: envInt("DB_POOL_MAX", 5),
    idleTimeoutMillis: envInt("DB_POOL_IDLE_TIMEOUT_MS", 30_000),
    connectionTimeoutMillis: envInt("DB_CONNECT_TIMEOUT_MS", 5_000),
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

function getPrismaClient(): PrismaClient {
  // Cache across hot reloads (dev) and warm serverless isolates (prod).
  const client = globalForPrisma.prisma ?? createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Built on first use, not at import time. `next build` imports every route
 * module to collect page data, and a build environment legitimately has no
 * DATABASE_URL — connecting eagerly turned that into a failed build instead of
 * a request-time error. Same rule as getServerEnv() in @/lib/env.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
