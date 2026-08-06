import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describePasskeyError,
  detectPasskeySupport,
  passkeyRegisterLabel,
  passkeySignInLabel,
} from "@/lib/auth/passkeys";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("passkeySignInLabel / passkeyRegisterLabel", () => {
  it("uses biometric copy when a platform authenticator is available", () => {
    expect(passkeySignInLabel("biometric")).toBe("Sign in with Face ID / fingerprint");
    expect(passkeyRegisterLabel("biometric")).toBe("Enable biometric / passkey login");
  });

  it("falls back to generic passkey copy otherwise", () => {
    expect(passkeySignInLabel("passkey")).toBe("Sign in with passkey");
    expect(passkeyRegisterLabel("passkey")).toBe("Enable passkey login");
  });
});

describe("detectPasskeySupport", () => {
  it("hides the control outside a secure context", async () => {
    vi.stubGlobal("window", {
      isSecureContext: false,
      PublicKeyCredential: function PublicKeyCredential() {},
    });
    vi.stubGlobal("navigator", {
      credentials: { create: vi.fn(), get: vi.fn() },
    });

    await expect(detectPasskeySupport()).resolves.toEqual({
      mode: "hidden",
      webAuthn: false,
      platformAuthenticator: false,
    });
  });

  it("hides the control when WebAuthn APIs are missing", async () => {
    vi.stubGlobal("window", {
      isSecureContext: true,
      PublicKeyCredential: undefined,
    });
    vi.stubGlobal("navigator", { credentials: undefined });

    await expect(detectPasskeySupport()).resolves.toEqual({
      mode: "hidden",
      webAuthn: false,
      platformAuthenticator: false,
    });
  });

  it("reports biometric mode when a platform authenticator is available", async () => {
    const PublicKeyCredential = Object.assign(function PublicKeyCredential() {}, {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
    });
    vi.stubGlobal("window", {
      isSecureContext: true,
      PublicKeyCredential,
    });
    vi.stubGlobal("navigator", {
      credentials: { create: vi.fn(), get: vi.fn() },
    });

    await expect(detectPasskeySupport()).resolves.toEqual({
      mode: "biometric",
      webAuthn: true,
      platformAuthenticator: true,
    });
  });

  it("reports generic passkey mode when only cross-platform WebAuthn exists", async () => {
    const PublicKeyCredential = Object.assign(function PublicKeyCredential() {}, {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(false),
    });
    vi.stubGlobal("window", {
      isSecureContext: true,
      PublicKeyCredential,
    });
    vi.stubGlobal("navigator", {
      credentials: { create: vi.fn(), get: vi.fn() },
    });

    await expect(detectPasskeySupport()).resolves.toEqual({
      mode: "passkey",
      webAuthn: true,
      platformAuthenticator: false,
    });
  });
});

describe("describePasskeyError", () => {
  it("stays quiet when the user cancels the biometric prompt", () => {
    expect(describePasskeyError({ name: "NotAllowedError", message: "The operation was aborted." })).toBeNull();
    expect(describePasskeyError({ name: "AbortError", message: "Aborted" })).toBeNull();
    expect(describePasskeyError({ code: "ERROR_CEREMONY_ABORTED", message: "Aborted" })).toBeNull();
  });

  it("maps Supabase Auth passkey error codes", () => {
    expect(describePasskeyError({ code: "passkey_disabled", message: "disabled" })).toMatch(
      /not enabled/i
    );
    expect(describePasskeyError({ code: "webauthn_challenge_expired", message: "expired" })).toMatch(
      /timed out/i
    );
    expect(
      describePasskeyError({ code: "webauthn_credential_not_found", message: "missing" })
    ).toMatch(/No passkey matched/i);
  });

  it("falls back to the server message when unknown", () => {
    expect(describePasskeyError({ message: "Custom failure" })).toBe("Custom failure");
  });
});
