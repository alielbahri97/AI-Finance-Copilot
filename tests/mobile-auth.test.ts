import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyObject } from "jose";

/**
 * The Bearer path a native client authenticates with, end to end: a real
 * ES256-signed token, verified by the real verifier, against a key set that is
 * local instead of remote.
 *
 * Only the network fetch of the JWKS is replaced. Signature checking, issuer,
 * audience, expiry and the algorithm split all run for real, because those are
 * exactly the things a mocked verifier would stop testing.
 */
const jwks = vi.hoisted(() => ({
  resolve: vi.fn(),
  created: [] as string[],
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: (url: URL) => {
      jwks.created.push(url.toString());
      return (...args: unknown[]) => jwks.resolve(...args);
    },
  };
});

const db = vi.hoisted(() => ({
  findMemberUnique: vi.fn(),
  findMemberFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspaceMember: {
      findUnique: db.findMemberUnique,
      findFirst: db.findMemberFirst,
    },
  },
}));

const profile = vi.hoisted(() => ({ getOrCreateProfile: vi.fn() }));
vi.mock("@/lib/data", () => ({ getOrCreateProfile: profile.getOrCreateProfile }));

const cookieAuth = vi.hoisted(() => ({ getCookieUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getCookieUser: cookieAuth.getCookieUser }));

import {
  BearerAuthError,
  resetJwksCache,
  verifySupabaseAccessToken,
  userFromClaims,
} from "@/lib/auth/bearer";
import { resolveRequestUser } from "@/lib/auth/request";
import { extractBearerToken, hasBearerAuthorization } from "@/lib/auth/token";
import {
  getWorkspaceContext,
  requireEditionFeature,
  requireWorkspace,
  sanitizeWorkspaceId,
  WORKSPACE_HEADER,
} from "@/lib/workspace/context";

const SUPABASE_URL = "https://project-ref.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const USER_ID = "11111111-2222-3333-4444-555555555555";

let privateKey: KeyObject | CryptoKey;
let publicKey: KeyObject | CryptoKey;
let otherPrivateKey: KeyObject | CryptoKey;
let publicJwk: JWK;

interface TokenOptions {
  issuer?: string;
  audience?: string;
  expiresIn?: number;
  key?: KeyObject | CryptoKey;
  algorithm?: string;
  claims?: Record<string, unknown>;
}

async function mintToken(options: TokenOptions = {}): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresIn = options.expiresIn ?? 3600;
  return new SignJWT({
    email: "person@example.com",
    role: "authenticated",
    user_metadata: { full_name: "Test Person" },
    ...options.claims,
  })
    .setProtectedHeader({ alg: options.algorithm ?? "ES256", kid: "test-key" })
    .setSubject(USER_ID)
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? "authenticated")
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + expiresIn)
    .sign(options.key ?? privateKey);
}

function bearerRequest(token: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/dashboard", {
    headers: { authorization: `Bearer ${token}`, ...headers },
  });
}

const MEMBERSHIP = {
  id: "member-1",
  role: "OWNER" as const,
  permissions: null,
  workspace: {
    id: "ws-shared",
    name: "Shared",
    type: "BUSINESS" as const,
    currency: "EUR",
  },
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  delete process.env.SUPABASE_JWT_SECRET;
  resetJwksCache();
  jwks.created.length = 0;

  if (!privateKey) {
    const pair = await generateKeyPair("ES256");
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    publicJwk = await exportJWK(pair.publicKey);
    otherPrivateKey = (await generateKeyPair("ES256")).privateKey;
  }
  jwks.resolve.mockImplementation(async () => publicKey);

  db.findMemberUnique.mockResolvedValue(null);
  db.findMemberFirst.mockResolvedValue(null);
  cookieAuth.getCookieUser.mockResolvedValue(null);
});

/* ------------------------------------------------------------------ */
/* Header parsing                                                      */
/* ------------------------------------------------------------------ */

describe("reading the Authorization header", () => {
  it("accepts the scheme in any case, with any run of spaces or tabs", () => {
    expect(extractBearerToken("Bearer abc")).toBe("abc");
    expect(extractBearerToken("bearer abc")).toBe("abc");
    expect(extractBearerToken("BEARER   abc")).toBe("abc");
    expect(extractBearerToken("Bearer\tabc")).toBe("abc");
    expect(extractBearerToken("  Bearer abc  ")).toBe("abc");
  });

  it("ignores anything that is not a bearer credential", () => {
    for (const header of [null, undefined, "", "Basic abc", "Bearer", "Bearer   ", "abc"]) {
      expect(extractBearerToken(header)).toBeNull();
    }
  });

  it("answers the middleware's question without pulling in the verifier", () => {
    expect(hasBearerAuthorization(new Headers({ authorization: "Bearer abc" }))).toBe(true);
    expect(hasBearerAuthorization(new Headers({ cookie: "sb-x-auth-token=y" }))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Token verification                                                  */
/* ------------------------------------------------------------------ */

describe("verifying a Supabase access token", () => {
  it("accepts a well-formed token and returns its claims", async () => {
    const claims = await verifySupabaseAccessToken(await mintToken());

    expect(claims.sub).toBe(USER_ID);
    expect(claims.email).toBe("person@example.com");
    expect(claims.iss).toBe(ISSUER);
  });

  it("fetches the key set from the project's JWKS endpoint", async () => {
    await verifySupabaseAccessToken(await mintToken());

    expect(jwks.created).toEqual([`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`]);
  });

  it("builds the key set once and reuses it across requests", async () => {
    await verifySupabaseAccessToken(await mintToken());
    await verifySupabaseAccessToken(await mintToken());

    expect(jwks.created).toHaveLength(1);
  });

  it("rejects an expired token", async () => {
    const token = await mintToken({ expiresIn: -3600 });

    await expect(verifySupabaseAccessToken(token)).rejects.toMatchObject({
      name: "BearerAuthError",
      code: "expired",
    });
  });

  it("does not let the clock tolerance extend a token by anything useful", async () => {
    // One minute past expiry is outside the drift allowance; a token that only
    // just expired is the case tolerance exists for.
    await expect(verifySupabaseAccessToken(await mintToken({ expiresIn: -60 }))).rejects.toMatchObject(
      { code: "expired" }
    );
    await expect(verifySupabaseAccessToken(await mintToken({ expiresIn: -2 }))).resolves.toBeTruthy();
  });

  it("rejects a token minted for another audience", async () => {
    const token = await mintToken({ audience: "service_role" });

    await expect(verifySupabaseAccessToken(token)).rejects.toMatchObject({
      code: "invalid_audience",
    });
  });

  it("rejects a token minted by another issuer", async () => {
    const token = await mintToken({ issuer: "https://evil.supabase.co/auth/v1" });

    await expect(verifySupabaseAccessToken(token)).rejects.toMatchObject({
      code: "invalid_issuer",
    });
  });

  it("rejects a token signed with the wrong key", async () => {
    const token = await mintToken({ key: otherPrivateKey });

    await expect(verifySupabaseAccessToken(token)).rejects.toMatchObject({
      code: "invalid_signature",
    });
  });

  it("rejects malformed input rather than throwing something unrecognisable", async () => {
    for (const value of ["", "not-a-jwt", "a.b", "a.b.c", "...."]) {
      await expect(verifySupabaseAccessToken(value)).rejects.toBeInstanceOf(BearerAuthError);
    }
  });

  it("refuses anonymous sessions, which have no profile and no workspace", async () => {
    const token = await mintToken({ claims: { is_anonymous: true } });

    await expect(verifySupabaseAccessToken(token)).rejects.toMatchObject({
      code: "invalid_claims",
    });
  });

  it("says so plainly when the project URL is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    resetJwksCache();

    await expect(verifySupabaseAccessToken("a.b.c")).rejects.toMatchObject({
      code: "not_configured",
    });
  });

  it("maps the verified claims onto the Supabase user the rest of the code expects", () => {
    const user = userFromClaims({
      sub: USER_ID,
      email: "person@example.com",
      user_metadata: { full_name: "Test Person" },
      iat: 1_700_000_000,
    });

    expect(user.id).toBe(USER_ID);
    expect(user.email).toBe("person@example.com");
    expect(user.user_metadata.full_name).toBe("Test Person");
    expect(user.created_at).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
});

/* ------------------------------------------------------------------ */
/* Algorithms                                                          */
/* ------------------------------------------------------------------ */

describe("the split between asymmetric and legacy signing", () => {
  it("verifies a legacy HS256 token against the shared secret", async () => {
    process.env.SUPABASE_JWT_SECRET = "a-very-long-legacy-supabase-jwt-secret-value";
    const token = await mintToken({
      algorithm: "HS256",
      key: new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET) as never,
    });

    await expect(verifySupabaseAccessToken(token)).resolves.toMatchObject({ sub: USER_ID });
    // The shared secret path must never reach for the public key set.
    expect(jwks.created).toEqual([]);
  });

  it("refuses an HS256 token when no legacy secret is configured", async () => {
    const token = await mintToken({
      algorithm: "HS256",
      key: new TextEncoder().encode("some-secret-the-server-does-not-know") as never,
    });

    await expect(verifySupabaseAccessToken(token)).rejects.toMatchObject({
      code: "not_configured",
    });
  });

  it("never verifies an HS256 token against the public key set", async () => {
    // The algorithm-confusion attack: sign with the public JWK as if it were a
    // shared secret and ask the server to check it symmetrically.
    process.env.SUPABASE_JWT_SECRET = "the-real-legacy-secret";
    const forged = await mintToken({
      algorithm: "HS256",
      key: new TextEncoder().encode(JSON.stringify(publicJwk)) as never,
    });

    await expect(verifySupabaseAccessToken(forged)).rejects.toBeInstanceOf(BearerAuthError);
  });

  it("refuses an unsigned token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: USER_ID, iss: ISSUER, aud: "authenticated" })
    ).toString("base64url");

    await expect(verifySupabaseAccessToken(`${header}.${payload}.`)).rejects.toBeInstanceOf(
      BearerAuthError
    );
  });
});

/* ------------------------------------------------------------------ */
/* Choosing between the two identification schemes                     */
/* ------------------------------------------------------------------ */

describe("resolving who is calling", () => {
  it("uses the cookie session when no token is presented", async () => {
    cookieAuth.getCookieUser.mockResolvedValue({ id: "cookie-user" });

    const user = await resolveRequestUser(new Request("http://localhost/api/dashboard"));

    expect(user).toEqual({ id: "cookie-user" });
    expect(cookieAuth.getCookieUser).toHaveBeenCalledTimes(1);
  });

  it("uses the token when one is presented, and never touches the cookie session", async () => {
    cookieAuth.getCookieUser.mockResolvedValue({ id: "cookie-user" });

    const user = await resolveRequestUser(bearerRequest(await mintToken()));

    expect(user?.id).toBe(USER_ID);
    expect(cookieAuth.getCookieUser).not.toHaveBeenCalled();
  });

  it("refuses a bad token instead of falling back to whoever the cookie says", async () => {
    // Falling back here would mean a stale token silently resolves to the
    // browser's session, which hides client bugs and surprises everyone.
    cookieAuth.getCookieUser.mockResolvedValue({ id: "cookie-user" });

    const user = await resolveRequestUser(bearerRequest(await mintToken({ expiresIn: -3600 })));

    expect(user).toBeNull();
    expect(cookieAuth.getCookieUser).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Workspace selection                                                 */
/* ------------------------------------------------------------------ */

describe("choosing the workspace from a header", () => {
  it("applies the same sanitisation the cookie always had", () => {
    expect(sanitizeWorkspaceId("ws-abc_123")).toBe("ws-abc_123");
    expect(sanitizeWorkspaceId("  ws-abc  ")).toBe("ws-abc");
    expect(sanitizeWorkspaceId("ws abc")).toBeNull();
    expect(sanitizeWorkspaceId("ws/../etc")).toBeNull();
    expect(sanitizeWorkspaceId("'; DROP TABLE workspaces--")).toBeNull();
    expect(sanitizeWorkspaceId("w".repeat(65))).toBeNull();
    expect(sanitizeWorkspaceId("w".repeat(64))).toHaveLength(64);
    expect(sanitizeWorkspaceId("")).toBeNull();
    expect(sanitizeWorkspaceId(null)).toBeNull();
  });

  it("looks up the requested workspace and re-verifies membership in the database", async () => {
    db.findMemberUnique.mockResolvedValue(MEMBERSHIP);

    const ctx = await getWorkspaceContext(
      bearerRequest(await mintToken(), { [WORKSPACE_HEADER]: "ws-shared" })
    );

    expect(db.findMemberUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: "ws-shared", userId: USER_ID } },
      select: { id: true, role: true, permissions: true, workspace: true },
    });
    expect(ctx?.workspace.id).toBe("ws-shared");
  });

  it("falls back to the default workspace when the header names one the user is not in", async () => {
    // The header is a hint. Not being a member of what it names is not an
    // error, it just does not select anything.
    db.findMemberUnique.mockResolvedValue(null);
    db.findMemberFirst.mockResolvedValue({ ...MEMBERSHIP, workspace: { ...MEMBERSHIP.workspace, id: "ws-own" } });

    const ctx = await getWorkspaceContext(
      bearerRequest(await mintToken(), { [WORKSPACE_HEADER]: "ws-someone-elses" })
    );

    expect(ctx?.workspace.id).toBe("ws-own");
  });

  it("never sends a rejected header value to the database", async () => {
    db.findMemberFirst.mockResolvedValue(MEMBERSHIP);

    await getWorkspaceContext(
      bearerRequest(await mintToken(), { [WORKSPACE_HEADER]: "not a valid id" })
    );

    expect(db.findMemberUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId_userId: expect.objectContaining({ workspaceId: "not a valid id" }),
        }),
      })
    );
  });

  it("narrows the member's permissions to what the workspace's edition supports", async () => {
    db.findMemberUnique.mockResolvedValue({
      ...MEMBERSHIP,
      workspace: { ...MEMBERSHIP.workspace, type: "PERSONAL" },
    });

    const ctx = await getWorkspaceContext(
      bearerRequest(await mintToken(), { [WORKSPACE_HEADER]: "ws-shared" })
    );

    // An owner still loses what a Personal workspace has no concept of.
    expect(ctx?.permissions.has("view_transactions")).toBe(true);
    expect(ctx?.permissions.has("view_invoices")).toBe(false);
    expect(ctx?.permissions.has("manage_members")).toBe(false);
  });

  it("returns nothing at all when the token does not verify", async () => {
    db.findMemberUnique.mockResolvedValue(MEMBERSHIP);

    const ctx = await getWorkspaceContext(
      bearerRequest(await mintToken({ key: otherPrivateKey }), {
        [WORKSPACE_HEADER]: "ws-shared",
      })
    );

    expect(ctx).toBeNull();
    expect(db.findMemberUnique).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

describe("the route guards over a Bearer request", () => {
  it("answers 401 without a usable token", async () => {
    const auth = await requireWorkspace(
      bearerRequest(await mintToken({ expiresIn: -3600 })),
      "view_transactions"
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(401);
      expect(await auth.response.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("answers 403 naming the permission the member is missing", async () => {
    db.findMemberUnique.mockResolvedValue({ ...MEMBERSHIP, role: "VIEWER" });

    const auth = await requireWorkspace(
      bearerRequest(await mintToken(), { [WORKSPACE_HEADER]: "ws-shared" }),
      "edit_transactions"
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(403);
      expect(await auth.response.json()).toMatchObject({
        code: "FORBIDDEN",
        permission: "edit_transactions",
      });
    }
  });

  it("answers 404 for a feature the workspace's edition does not have", async () => {
    db.findMemberUnique.mockResolvedValue(MEMBERSHIP);

    const auth = await requireEditionFeature(
      bearerRequest(await mintToken(), { [WORKSPACE_HEADER]: "ws-shared" }),
      "budgets",
      "view_reports"
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(404);
      expect(await auth.response.json()).toMatchObject({
        code: "WRONG_EDITION",
        feature: "budgets",
      });
    }
  });

  it("still works when called the old way, with no request at all", async () => {
    // Every existing call site passes permissions only. Those must keep
    // resolving through the cookie session exactly as before.
    cookieAuth.getCookieUser.mockResolvedValue({ id: "cookie-user" });
    db.findMemberFirst.mockResolvedValue(MEMBERSHIP);

    const auth = await requireWorkspace("view_transactions");

    expect(auth.ok).toBe(true);
    expect(cookieAuth.getCookieUser).toHaveBeenCalledTimes(1);
  });
});
