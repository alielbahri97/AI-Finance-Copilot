/**
 * Structured JSON logger for server code (API routes, cron jobs, libs).
 * One line per event so log aggregators (Vercel, Datadog, Loki...) can parse
 * fields without custom grammars.
 *
 * Sentry: if you use @sentry/nextjs, initialize it in instrumentation.ts and
 * it will capture unhandled route errors on its own; `logger.error` remains
 * the structured trail. See README "Monitoring" for the wiring.
 */

export type LogFields = Record<string, unknown>;

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      // Stack traces are server-side only; safe to log, never sent to clients.
      stack: error.stack,
    };
  }
  return { name: "UnknownError", message: String(error) };
}

function emit(level: "debug" | "info" | "warn" | "error", msg: string, fields?: LogFields): void {
  const entry: LogFields = {
    level,
    time: new Date().toISOString(),
    msg,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug(msg: string, fields?: LogFields): void {
    if (process.env.NODE_ENV !== "production") emit("debug", msg, fields);
  },
  info(msg: string, fields?: LogFields): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields?: LogFields): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields?: LogFields): void {
    emit("error", msg, fields);
  },
};
