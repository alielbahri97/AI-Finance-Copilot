import "server-only";

import type { User } from "@supabase/supabase-js";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";

export { extractBearerToken } from "./token";

/**
 * Verifies Supabase access tokens presented as `Authorization: Bearer <jwt>`.
 *
 * Native clients cannot carry the `@supabase/ssr` cookie session, so they send
 * the access token instead. Verification happens locally against the project's
 * published signing keys rather than through `supabase.auth.getUser()`: that
 * call is a network round trip to the auth server on every single API request,
 * which is exactly the cost the middleware already fights with a timeout and a
 * hand-rolled race.
 *
 * Two signing schemes are supported:
 *
 *   Asymmetric (preferred) — the project publishes ES256/RS256/EdDSA public
 *   keys at `/auth/v1/.well-known/jwks.json`. Nothing secret has to be
 *   configured on this server and keys can be rotated without a deploy.
 *
 *   Legacy symmetric — projects that still sign with the shared HS256 secret
 *   need SUPABASE_JWT_SECRET set. Supported so a deployment is not forced to
 *   migrate before shipping the app, but it means the API server holds a key
 *   that can mint tokens, so prefer the asymmetric scheme.
 */

/** Supabase issues every logged-in user token with this audience. */
export const SUPABASE_JWT_AUDIENCE = "authenticated";

/**
 * Tolerance for clock drift between the auth server that stamped `exp`/`iat`
 * and this server. Small enough that an expired token is not usefully
 * extended, large enough to survive ordinary NTP skew.
 */
export const CLOCK_TOLERANCE_SECONDS = 5;

export type BearerAuthErrorCode =
  | "not_configured"
  | "malformed"
  | "expired"
  | "invalid_audience"
  | "invalid_issuer"
  | "invalid_signature"
  | "invalid_claims";

/**
 * A token that was presented but could not be trusted. Carries a code so the
 * caller can log the reason without leaking it to the client, which always
 * just sees 401.
 */
export class BearerAuthError extends Error {
  readonly code: BearerAuthErrorCode;

  constructor(code: BearerAuthErrorCode, message: string) {
    super(message);
    this.name = "BearerAuthError";
    this.code = code;
  }
}

export interface SupabaseJwtClaims extends JWTPayload {
  sub: string;
  email?: string;
  phone?: string;
  role?: string;
  session_id?: string;
  is_anonymous?: boolean;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

function supabaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/** The `iss` claim Supabase stamps: the project URL plus the auth mount point. */
export function expectedIssuer(): string | null {
  const url = supabaseUrl();
  return url ? `${url}/auth/v1` : null;
}

function legacySecret(): Uint8Array | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

type RemoteKeySet = ReturnType<typeof createRemoteJWKSet>;

/**
 * One key set per process, keyed by URL so a changed environment in a test does
 * not keep serving the previous project's keys. `createRemoteJWKSet` does the
 * actual caching: it holds the fetched JWKS for `cacheMaxAge` and refuses to
 * re-fetch more than once per `cooldownDuration`, so an unknown `kid` cannot be
 * used to hammer the auth server.
 */
const keySets = new Map<string, RemoteKeySet>();

function remoteKeySet(): RemoteKeySet | null {
  const url = supabaseUrl();
  if (!url) return null;
  const jwksUrl = `${url}/auth/v1/.well-known/jwks.json`;
  const cached = keySets.get(jwksUrl);
  if (cached) return cached;
  const created = createRemoteJWKSet(new URL(jwksUrl), {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
  });
  keySets.set(jwksUrl, created);
  return created;
}

/** Test seam: drops the memoized key sets so a new URL takes effect. */
export function resetJwksCache(): void {
  keySets.clear();
}

/** True when this deployment can verify a Bearer token at all. */
export function isBearerAuthConfigured(): boolean {
  return Boolean(supabaseUrl());
}

function mapVerifyError(error: unknown): BearerAuthError {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return new BearerAuthError("expired", "The access token has expired.");
    case "ERR_JWT_CLAIM_VALIDATION_FAILED": {
      const claim = (error as { claim?: string }).claim;
      if (claim === "aud") {
        return new BearerAuthError("invalid_audience", "Unexpected token audience.");
      }
      if (claim === "iss") {
        return new BearerAuthError("invalid_issuer", "Unexpected token issuer.");
      }
      return new BearerAuthError("invalid_claims", "The access token claims are not valid.");
    }
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
    case "ERR_JWKS_NO_MATCHING_KEY":
      return new BearerAuthError("invalid_signature", "The access token signature is not valid.");
    case "ERR_JWS_INVALID":
    case "ERR_JWT_INVALID":
      return new BearerAuthError("malformed", "The access token is malformed.");
    default:
      return new BearerAuthError("invalid_signature", "The access token could not be verified.");
  }
}

/**
 * Verifies signature, issuer, audience and expiry, and returns the claims.
 * Throws BearerAuthError for every rejection so callers have one thing to
 * catch.
 */
export async function verifySupabaseAccessToken(token: string): Promise<SupabaseJwtClaims> {
  const issuer = expectedIssuer();
  if (!issuer) {
    throw new BearerAuthError(
      "not_configured",
      "NEXT_PUBLIC_SUPABASE_URL is not set, so Bearer tokens cannot be verified."
    );
  }

  let algorithm: string | undefined;
  try {
    algorithm = decodeProtectedHeader(token).alg;
  } catch {
    throw new BearerAuthError("malformed", "The access token is not a well-formed JWT.");
  }
  if (!algorithm) {
    throw new BearerAuthError("malformed", "The access token header names no algorithm.");
  }

  const options = {
    issuer,
    audience: SUPABASE_JWT_AUDIENCE,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  };

  try {
    // The algorithm decides which key material is even considered, so a token
    // that asks to be checked with the shared secret can never be verified
    // against a public key, and vice versa. This is what closes the algorithm
    // confusion hole that comes from handing an unconstrained key to a
    // verifier.
    if (algorithm === "HS256") {
      const secret = legacySecret();
      if (!secret) {
        throw new BearerAuthError(
          "not_configured",
          "The token is signed with the legacy shared secret but SUPABASE_JWT_SECRET is not set."
        );
      }
      const { payload } = await jwtVerify(token, secret, { ...options, algorithms: ["HS256"] });
      return assertUserClaims(payload);
    }

    const keys = remoteKeySet();
    if (!keys) {
      throw new BearerAuthError("not_configured", "No JWKS endpoint is configured.");
    }
    const { payload } = await jwtVerify(token, keys, {
      ...options,
      algorithms: ["RS256", "ES256", "EdDSA"],
    });
    return assertUserClaims(payload);
  } catch (error) {
    if (error instanceof BearerAuthError) throw error;
    throw mapVerifyError(error);
  }
}

function assertUserClaims(payload: JWTPayload): SupabaseJwtClaims {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new BearerAuthError("invalid_claims", "The access token carries no subject.");
  }
  // Anonymous sign-ins get the same audience as real users. They have no
  // profile and no workspace, and letting one through would create both.
  if (payload.is_anonymous === true) {
    throw new BearerAuthError("invalid_claims", "Anonymous sessions cannot use this API.");
  }
  return payload as SupabaseJwtClaims;
}

/**
 * Builds the Supabase `User` the rest of the codebase already expects from the
 * verified claims. Only the fields the server actually reads are populated:
 * everything downstream uses `id`, `email` and `user_metadata`.
 */
export function userFromClaims(claims: SupabaseJwtClaims): User {
  const issuedAt = typeof claims.iat === "number" ? new Date(claims.iat * 1000) : new Date();
  return {
    id: claims.sub,
    aud: typeof claims.aud === "string" ? claims.aud : SUPABASE_JWT_AUDIENCE,
    role: claims.role,
    email: claims.email,
    phone: claims.phone,
    app_metadata: (claims.app_metadata ?? {}) as User["app_metadata"],
    user_metadata: (claims.user_metadata ?? {}) as User["user_metadata"],
    created_at: issuedAt.toISOString(),
  } as User;
}

/** Verifies a token and returns it as a Supabase user. */
export async function userFromAccessToken(token: string): Promise<User> {
  return userFromClaims(await verifySupabaseAccessToken(token));
}
