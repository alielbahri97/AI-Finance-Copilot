import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/integrations/crypto";

const HEX_KEY = "a".repeat(64);

describe("integration token encryption (AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = HEX_KEY;
  });

  afterEach(() => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
  });

  it("round-trips arbitrary secrets", () => {
    for (const secret of ["token-123", "", "🔐 ünïcode", "x".repeat(10_000)]) {
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    }
  });

  it("produces a different ciphertext per call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered payloads (auth tag)", () => {
    const payload = Buffer.from(encryptSecret("secret"), "base64");
    payload[payload.length - 1] ^= 0xff;
    expect(() => decryptSecret(payload.toString("base64"))).toThrow();
  });

  it("rejects payloads that are too short", () => {
    expect(() => decryptSecret(Buffer.from("short").toString("base64"))).toThrow(
      "Invalid encrypted payload"
    );
  });

  it("accepts base64 keys as well as hex", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(isEncryptionConfigured()).toBe(true);
    expect(decryptSecret(encryptSecret("with-base64-key"))).toBe("with-base64-key");
  });

  it("reports unconfigured when the key is missing or malformed", () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(false);
    process.env.INTEGRATION_ENCRYPTION_KEY = "not-a-key";
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow("INTEGRATION_ENCRYPTION_KEY is not configured");
  });
});
