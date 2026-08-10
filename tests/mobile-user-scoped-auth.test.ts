import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateKeyPair, SignJWT, type KeyObject } from "jose";

/**
 * A dozen routes authenticate with `getUser()` alone and never resolve a
 * workspace — the notification feed, push subscriptions, the profile, the
 * onboarding steps, the product tour. Their data is per-user, so that is the
 * right guard, but it read cookies only and therefore answered 401 to every
 * native client.
 *
 * These tests pin the fix: `getUser()` now honours a Bearer token taken from
 * the ambient request, and is otherwise unchanged.
 */

const jwks = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: () => (...args: unknown[]) => jwks.resolve(...args),
  };
});

const ambient = vi.hoisted(() => ({ headers: vi.fn(), cookies: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: ambient.headers,
  cookies: ambient.cookies,
}));

const supabase = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: supabase.getUser } }),
}));

import { resetJwksCache } from "@/lib/auth/bearer";
import { getCookieUser, getUser } from "@/lib/supabase/server";

const SUPABASE_URL = "https://project-ref.supabase.co";
const USER_ID = "11111111-2222-3333-4444-555555555555";

let privateKey: KeyObject | CryptoKey;
let publicKey: KeyObject | CryptoKey;

async function mintToken(expiresIn = 3600): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: "person@example.com", role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setSubject(USER_ID)
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience("authenticated")
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + expiresIn)
    .sign(privateKey);
}

/** Stands in for the ambient request a route handler is serving. */
function servingRequest(headerBag: Record<string, string>): void {
  ambient.headers.mockResolvedValue(new Headers(headerBag));
  ambient.cookies.mockResolvedValue({ getAll: () => [], get: () => undefined, set: () => undefined });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  resetJwksCache();

  if (!privateKey) {
    const pair = await generateKeyPair("ES256");
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }
  jwks.resolve.mockImplementation(async () => publicKey);

  supabase.getUser.mockResolvedValue({ data: { user: { id: "cookie-user" } } });
  servingRequest({});
});

describe("getUser on a user-scoped route", () => {
  it("resolves a Bearer token without asking the auth server anything", async () => {
    servingRequest({ authorization: `Bearer ${await mintToken()}` });

    const user = await getUser();

    expect(user?.id).toBe(USER_ID);
    expect(user?.email).toBe("person@example.com");
    // The whole point: no network round trip to Supabase Auth.
    expect(supabase.getUser).not.toHaveBeenCalled();
  });

  it("takes the cookie path untouched when there is no token", async () => {
    servingRequest({ cookie: "sb-project-auth-token=abc" });

    await expect(getUser()).resolves.toEqual({ id: "cookie-user" });
    expect(supabase.getUser).toHaveBeenCalledTimes(1);
  });

  it("returns nobody for a token that does not verify, rather than the cookie user", async () => {
    servingRequest({ authorization: `Bearer ${await mintToken(-3600)}` });

    await expect(getUser()).resolves.toBeNull();
    expect(supabase.getUser).not.toHaveBeenCalled();
  });

  it("still exposes the cookie-only resolution for callers that want exactly that", async () => {
    servingRequest({ authorization: `Bearer ${await mintToken()}` });

    await expect(getCookieUser()).resolves.toEqual({ id: "cookie-user" });
  });

  it("falls back to the cookie path outside a request scope instead of throwing", async () => {
    // Build-time evaluation and unit tests both look like this.
    ambient.headers.mockRejectedValue(new Error("headers() outside a request"));

    await expect(getUser()).resolves.toEqual({ id: "cookie-user" });
  });
});
