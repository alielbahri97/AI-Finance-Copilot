/**
 * Helpers for classifying and safely logging Postgres / Prisma connectivity
 * failures without leaking connection strings or passwords.
 */

const CONNECTIVITY_CODES = new Set([
  // Prisma
  "P1001", // can't reach database server
  "P1002", // database server timed out
  "P1008", // operations timed out
  "P1017", // server closed the connection
  // Node / libpq style
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  // Postgres SQLSTATE
  "57P01", // admin shutdown
  "57P02", // crash shutdown
  "57P03", // cannot connect now
  "53300", // too many connections
  "53400", // configuration limit exceeded
  "08000", // connection exception
  "08001", // sqlclient unable to establish connection
  "08003", // connection does not exist
  "08006", // connection failure
  "08P01", // protocol violation
]);

const CONNECTIVITY_MESSAGE_RE =
  /can'?t reach database|database server|connection (?:timed out|terminated|refused|reset)|timeout expired|too many clients|too many connections|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|server closed the connection|Connection terminated unexpectedly|remaining connection slots/i;

/**
 * "The code expects a newer schema than the database has" — a deploy landed
 * before its migration ran. Unlike a connectivity blip, retrying never helps:
 * someone has to apply the pending migrations.
 */
const SCHEMA_DRIFT_CODES = new Set([
  // Prisma
  "P2021", // table does not exist
  "P2022", // column does not exist
  "P2003", // foreign key constraint failed (FK not created yet)
  // Postgres SQLSTATE
  "42P01", // undefined_table
  "42P10", // invalid_column_reference
  "42703", // undefined_column
  "42704", // undefined_object (missing enum value, type, index)
  "42883", // undefined_function
]);

/**
 * Message fallbacks for drivers that surface the raw Postgres text without a
 * code. "invalid input value for enum" is the signature of writing an enum
 * member that a pending migration was supposed to add.
 */
const SCHEMA_DRIFT_MESSAGE_RE =
  /does not exist in the current database|relation "[^"]*" does not exist|column "[^"]*" does not exist|invalid input value for enum/i;

export interface SafeDbError {
  name: string;
  message: string;
  code?: string;
  errno?: string | number;
  syscall?: string;
  severity?: string;
}

function redactSecrets(message: string): string {
  return message
    .replace(/postgresql:\/\/[^\s"']+/gi, "postgresql://***")
    .replace(/postgres:\/\/[^\s"']+/gi, "postgres://***")
    .replace(/:[^:@/\s]{4,}@/g, ":***@");
}

function readCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  for (const key of ["code", "errno"] as const) {
    const v = e[key];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  // Prisma's driver adapter wraps the underlying pg error, which is what
  // carries the SQLSTATE; without this a code-less wrapper looks unclassifiable.
  return depth < 3 ? readCode(e.cause, depth + 1) : undefined;
}

/** Safe, secret-free fields suitable for structured logs / health responses. */
export function describeDatabaseError(error: unknown): SafeDbError {
  if (!(error instanceof Error)) {
    return { name: "UnknownError", message: redactSecrets(String(error)) };
  }

  const e = error as Error & {
    code?: string | number;
    errno?: string | number;
    syscall?: string;
    severity?: string;
  };

  return {
    name: error.name,
    message: redactSecrets(error.message).slice(0, 300),
    code: e.code !== undefined ? String(e.code) : undefined,
    errno: e.errno,
    syscall: e.syscall,
    severity: e.severity,
  };
}

/**
 * True when the database is reachable but its schema is behind the code —
 * i.e. a migration is pending. Retrying is pointless.
 */
export function isSchemaOutOfDate(error: unknown): boolean {
  const code = readCode(error);
  if (code && SCHEMA_DRIFT_CODES.has(code)) return true;
  return error instanceof Error && SCHEMA_DRIFT_MESSAGE_RE.test(error.message);
}

/** True when the failure is likely a transient DB/pooler outage. */
export function isDatabaseUnavailable(error: unknown): boolean {
  // A missing table proves the server answered, so never report it as an outage.
  if (isSchemaOutOfDate(error)) return false;

  const code = readCode(error);
  if (code && CONNECTIVITY_CODES.has(code)) return true;

  if (error instanceof Error) {
    if (/PrismaClientInitializationError|PrismaClientRustPanicError/i.test(error.name)) {
      return true;
    }
    if (CONNECTIVITY_MESSAGE_RE.test(error.message)) return true;
  }

  return false;
}

/**
 * Why a data fetch failed, for callers that render one degraded page but want
 * to explain it accurately. `null` means "not a database problem" — rethrow so
 * the error boundary and logs treat it as a real bug.
 */
export type DatabaseFailureKind = "unavailable" | "schema_outdated";

export function classifyDatabaseFailure(error: unknown): DatabaseFailureKind | null {
  if (isSchemaOutOfDate(error)) return "schema_outdated";
  if (isDatabaseUnavailable(error)) return "unavailable";
  return null;
}
