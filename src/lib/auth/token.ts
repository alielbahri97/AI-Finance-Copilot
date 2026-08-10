/**
 * Header parsing shared by the middleware and the verifier.
 *
 * Deliberately dependency-free: the middleware runs on the Edge runtime and
 * only needs to know whether a token is present, so it must not have to pull in
 * the JWT library or anything marked server-only to find out.
 */

/** Carries the workspace selection for clients that cannot set cookies. */
export const WORKSPACE_HEADER = "x-ballast-workspace";

/**
 * Pulls the raw token out of an Authorization header value, or returns null
 * when the header is absent or is not a Bearer credential.
 *
 * The scheme is matched case-insensitively because HTTP auth schemes are
 * case-insensitive and clients are inconsistent about it; the token itself is
 * returned untouched.
 */
export function extractBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/** True when the request identifies itself with a token rather than a cookie. */
export function hasBearerAuthorization(headers: Headers): boolean {
  return extractBearerToken(headers.get("authorization")) !== null;
}
