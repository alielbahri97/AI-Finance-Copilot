import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for integration tokens at rest.
 * INTEGRATION_ENCRYPTION_KEY must be 32 bytes of hex (64 chars) or base64;
 * generate one with: openssl rand -hex 32
 * Payload layout: base64( iv[12] || authTag[16] || ciphertext ).
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function loadKey(): Buffer | null {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const decoded = Buffer.from(trimmed, "base64");
  return decoded.length === 32 ? decoded : null;
}

export function isEncryptionConfigured(): boolean {
  return loadKey() !== null;
}

export function encryptSecret(plain: string): string {
  const key = loadKey();
  if (!key) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const key = loadKey();
  if (!key) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  }
  const raw = Buffer.from(payload, "base64");
  // GCM allows empty plaintext, so iv + tag alone is a valid payload.
  if (raw.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
