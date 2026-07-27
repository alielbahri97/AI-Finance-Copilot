import "server-only";

import { NextResponse } from "next/server";

import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Returns a 429 response when the caller exceeded the group's limit, null
 * otherwise. `identity` is the authenticated user id (preferred) or an IP.
 */
export async function enforceRateLimit(
  group: keyof typeof RATE_LIMITS,
  identity: string
): Promise<NextResponse | null> {
  const result = await checkRateLimit(`${group}:${identity}`, RATE_LIMITS[group]);
  if (result.allowed) return null;
  return NextResponse.json(
    {
      error: "Too many requests — please wait a moment and try again.",
      code: "RATE_LIMITED",
    },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}
