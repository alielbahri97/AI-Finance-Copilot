import { resolveAppUrl } from "@/lib/env-url";

/**
 * Canonical public origin for auth email redirects (confirm, reset password).
 *
 * Prefer NEXT_PUBLIC_APP_URL so production builds always embed the deployed
 * site — even if Site URL in Supabase is misconfigured to localhost, the
 * redirect_to query still points at production (and must be allow-listed).
 * A malformed value throws by name rather than producing an unusable link.
 *
 * Falls back to window.location.origin in the browser, then to the resolved
 * default for server-side callers without env set.
 */
export function getAppOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (raw?.trim()) return resolveAppUrl(raw, process.env.NODE_ENV === "production");

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return resolveAppUrl(undefined, process.env.NODE_ENV === "production");
}

/** Absolute /auth/callback URL with a safe in-app `next` path. */
export function authCallbackUrl(next: string): string {
  const path = next.startsWith("/") ? next : `/${next}`;
  const url = new URL("/auth/callback", getAppOrigin());
  url.searchParams.set("next", path);
  return url.toString();
}
