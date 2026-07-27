import "server-only";

import { NextResponse } from "next/server";

import { logger, serializeError } from "@/lib/logger";

/**
 * The one 500 path for API routes: logs a structured error (route + cause)
 * and returns the standard `{ error }` JSON shape with a safe public message.
 */
export function apiError(
  route: string,
  publicMessage: string,
  error: unknown,
  fields?: Record<string, unknown>
): NextResponse {
  logger.error("api_error", {
    route,
    publicMessage,
    error: serializeError(error),
    ...fields,
  });
  return NextResponse.json({ error: publicMessage }, { status: 500 });
}
