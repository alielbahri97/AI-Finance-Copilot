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

function readCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  for (const key of ["code", "errno"] as const) {
    const v = e[key];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return undefined;
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

/** True when the failure is likely a transient DB/pooler outage. */
export function isDatabaseUnavailable(error: unknown): boolean {
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
