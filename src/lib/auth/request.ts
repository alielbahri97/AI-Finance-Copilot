import "server-only";

import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { logger } from "@/lib/logger";
import { getUser } from "@/lib/supabase/server";

import { BearerAuthError, userFromAccessToken } from "./bearer";
import { extractBearerToken, WORKSPACE_HEADER } from "./token";

/**
 * Resolves who is making a request, from either of the two identification
 * schemes the API accepts.
 *
 * Web keeps the `@supabase/ssr` cookie session it has always used. Native
 * clients, which have no cookie jar the Supabase helpers can drive, send
 * `Authorization: Bearer <access token>` instead.
 *
 * The two are deliberately not blended: a request that presents a Bearer token
 * is answered on the token alone. Falling back to the cookie when a token fails
 * to verify would mean a stale or tampered token silently resolves to whoever
 * the browser happens to be logged in as, which is both surprising and a way to
 * mask a client bug in production.
 */

export { WORKSPACE_HEADER };

/** Anything with a readable `headers` bag: Request, NextRequest, or a stub. */
export interface HeaderCarrier {
  headers: Headers;
}

export type AuthMode = "bearer" | "cookie";

/**
 * Reads one header from the explicit request when there is one, and from the
 * ambient request otherwise.
 *
 * Route handlers can pass their `Request`; server components have none to pass,
 * so they fall through to `next/headers`. The ambient read is wrapped because
 * it throws outside a request scope, which is what unit tests and any
 * build-time evaluation look like.
 */
export async function requestHeader(
  name: string,
  request?: HeaderCarrier
): Promise<string | null> {
  if (request) return request.headers.get(name);
  try {
    return (await headers()).get(name);
  } catch {
    return null;
  }
}

/** Whether this request identifies itself with a token or with a cookie. */
export async function authMode(request?: HeaderCarrier): Promise<AuthMode> {
  const header = await requestHeader("authorization", request);
  return extractBearerToken(header) ? "bearer" : "cookie";
}

/**
 * The authenticated user, or null.
 *
 * Never throws for an unusable token: an API caller learns only that it was not
 * authenticated, while the reason is logged for the operator.
 */
export async function resolveRequestUser(request?: HeaderCarrier): Promise<User | null> {
  const token = extractBearerToken(await requestHeader("authorization", request));
  if (!token) {
    return getUser();
  }

  try {
    return await userFromAccessToken(token);
  } catch (error) {
    if (error instanceof BearerAuthError) {
      logger.warn("bearer_token_rejected", { code: error.code });
      return null;
    }
    logger.error("bearer_token_verification_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** The workspace id a Bearer client asked for, before any sanitisation. */
export async function requestedWorkspaceHeader(
  request?: HeaderCarrier
): Promise<string | null> {
  return requestHeader(WORKSPACE_HEADER, request);
}
