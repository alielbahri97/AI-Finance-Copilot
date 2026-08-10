import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyObject } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetGooglePushKeyCache,
  verifyPubsubPush,
} from "@/lib/billing/play/notifications";

/**
 * Authenticating a Pub/Sub push.
 *
 * `/api/billing/play/notifications` is public — Google presents no Ballast
 * session — so this check is the whole of its access control. A stranger who got
 * past it could grant themselves any plan by posting an invented payload, so it
 * is tested against real signatures rather than a mock: tokens are minted here
 * with a throwaway key pair, and Google's key endpoint is stubbed to publish the
 * matching public key.
 */

const AUDIENCE = "https://app.ballastmoney.com/api/billing/play/notifications";
const PUBSUB_ACCOUNT = "play-rtdn@ballast.iam.gserviceaccount.com";
const KID = "test-signing-key";

let privateKey: KeyObject | CryptoKey;
let publicJwk: JWK;

interface TokenOptions {
  audience?: string;
  issuer?: string;
  email?: string | null;
  emailVerified?: boolean;
  expiresIn?: string;
  kid?: string;
}

async function mintToken(options: TokenOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = {
    email_verified: options.emailVerified ?? true,
  };
  if (options.email !== null) claims.email = options.email ?? PUBSUB_ACCOUNT;

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: options.kid ?? KID })
    .setIssuer(options.issuer ?? "https://accounts.google.com")
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject("1234567890")
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
});

beforeEach(() => {
  process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE = AUDIENCE;
  delete process.env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT;
  resetGooglePushKeyCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE;
  delete process.env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT;
});

afterAll(() => {
  resetGooglePushKeyCache();
});

describe("authenticating a Pub/Sub push", () => {
  it("accepts a token Google signed for this endpoint", async () => {
    const result = await verifyPubsubPush(`Bearer ${await mintToken()}`);
    expect(result).toEqual({ ok: true, email: PUBSUB_ACCOUNT });
  });

  it("accepts the bare issuer spelling Google also uses", async () => {
    const result = await verifyPubsubPush(
      `Bearer ${await mintToken({ issuer: "accounts.google.com" })}`
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a lower-case bearer scheme, and surrounding whitespace", async () => {
    const result = await verifyPubsubPush(`  bearer ${await mintToken()}  `);
    expect(result.ok).toBe(true);
  });

  // The audience check is what stops a token minted for some other service on
  // the same Google Cloud project from being replayed here.
  it("rejects a token minted for a different audience", async () => {
    const result = await verifyPubsubPush(
      `Bearer ${await mintToken({ audience: "https://someone-elses-service.example.com" })}`
    );
    expect(result).toEqual({ ok: false, reason: "wrong_audience" });
  });

  it("rejects a token from an issuer that is not Google", async () => {
    const result = await verifyPubsubPush(
      `Bearer ${await mintToken({ issuer: "https://accounts.evil.example" })}`
    );
    expect(result).toEqual({ ok: false, reason: "wrong_issuer" });
  });

  it("rejects an expired token", async () => {
    const result = await verifyPubsubPush(`Bearer ${await mintToken({ expiresIn: "-1m" })}`);
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rejects a token signed with a key Google does not publish", async () => {
    const other = await generateKeyPair("RS256", { extractable: true });
    const forged = await new SignJWT({ email: PUBSUB_ACCOUNT })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer("https://accounts.google.com")
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(other.privateKey);

    const result = await verifyPubsubPush(`Bearer ${forged}`);
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  // An unsigned token is the oldest trick there is, and `alg: none` would be
  // catastrophic here: anyone could grant themselves a subscription.
  it("rejects an unsigned token", async () => {
    const [header, payload] = (await mintToken()).split(".");
    expect(await verifyPubsubPush(`Bearer ${header}.${payload}.`)).toEqual({
      ok: false,
      reason: "invalid_token",
    });
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", kid: KID })).toString("base64url");
    expect(await verifyPubsubPush(`Bearer ${noneHeader}.${payload}.`)).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  it("rejects nonsense, and an absent or malformed header", async () => {
    expect(await verifyPubsubPush("Bearer not-a-token")).toEqual({
      ok: false,
      reason: "invalid_token",
    });
    expect(await verifyPubsubPush(null)).toEqual({ ok: false, reason: "missing_token" });
    expect(await verifyPubsubPush(undefined)).toEqual({ ok: false, reason: "missing_token" });
    expect(await verifyPubsubPush("")).toEqual({ ok: false, reason: "missing_token" });
    // The token without the scheme, and the scheme without the token.
    expect(await verifyPubsubPush(await mintToken())).toEqual({
      ok: false,
      reason: "missing_token",
    });
    expect(await verifyPubsubPush("Bearer")).toEqual({ ok: false, reason: "missing_token" });
  });

  it("refuses everything when no audience is configured", async () => {
    delete process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE;
    expect(await verifyPubsubPush(`Bearer ${await mintToken()}`)).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });

  describe("with a service account pinned", () => {
    beforeEach(() => {
      process.env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT = PUBSUB_ACCOUNT;
    });

    it("accepts the pinned identity", async () => {
      expect((await verifyPubsubPush(`Bearer ${await mintToken()}`)).ok).toBe(true);
    });

    // Narrows trust from "any Google-issued token for this audience" to one
    // identity, which matters because the audience is a public URL.
    it("rejects another service account on the same project", async () => {
      const result = await verifyPubsubPush(
        `Bearer ${await mintToken({ email: "someone-else@ballast.iam.gserviceaccount.com" })}`
      );
      expect(result).toEqual({ ok: false, reason: "wrong_service_account" });
    });

    it("rejects a token with no email claim to check", async () => {
      const result = await verifyPubsubPush(`Bearer ${await mintToken({ email: null })}`);
      expect(result).toEqual({ ok: false, reason: "wrong_service_account" });
    });

    it("rejects an unverified address", async () => {
      const result = await verifyPubsubPush(`Bearer ${await mintToken({ emailVerified: false })}`);
      expect(result).toEqual({ ok: false, reason: "unverified_email" });
    });
  });

  it("caches Google's keys instead of refetching them per push", async () => {
    await verifyPubsubPush(`Bearer ${await mintToken()}`);
    await verifyPubsubPush(`Bearer ${await mintToken()}`);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
