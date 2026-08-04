import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isEmailConfigured } from "@/lib/notifications/email";
import { getEmailHealth, parseFromAddress } from "@/lib/notifications/email-health";

const SECRET_KEY = "re_9fZkQ2vTdeadbeefSECRETvalue";

function resendDomains(rows: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: rows }),
  };
}

/* ------------------------------------------------------------------ */
/* EMAIL_FROM sanitization                                             */
/* ------------------------------------------------------------------ */

describe("parseFromAddress", () => {
  it("extracts the domain from a display-name form", () => {
    expect(parseFromAddress("FinPilot <notifications@send.ballastmoney.com>")).toEqual({
      valid: true,
      domain: "send.ballastmoney.com",
    });
  });

  it("extracts the domain from a bare address and lowercases it", () => {
    expect(parseFromAddress("Notifications@Send.BallastMoney.com")).toEqual({
      valid: true,
      domain: "send.ballastmoney.com",
    });
  });

  it("tolerates a quoted display name and surrounding whitespace", () => {
    expect(parseFromAddress('  "FinPilot, Billing" <hi@example.co.uk>  ')).toEqual({
      valid: true,
      domain: "example.co.uk",
    });
  });

  it("never returns the local part or the display name", () => {
    const { domain } = parseFromAddress("Ali El Bahri <ali.elbahri@send.ballastmoney.com>");
    expect(domain).toBe("send.ballastmoney.com");
    expect(domain).not.toContain("ali");
    expect(domain).not.toContain("@");
  });

  it("rejects malformed values without echoing them", () => {
    for (const value of [
      undefined,
      "",
      "   ",
      "not-an-email",
      "missing-domain@",
      "@example.com",
      "two@at@example.com",
      "spaced address@example.com",
      "unclosed <hi@example.com",
      "trailing@example.com>",
      "hi@localhost",
      "hi@example..com",
      "hi@-example.com",
    ]) {
      expect(parseFromAddress(value)).toEqual({ valid: false, domain: null });
    }
  });
});

/* ------------------------------------------------------------------ */
/* Health reporting                                                    */
/* ------------------------------------------------------------------ */

describe("email health reporting", () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("reports an unconfigured channel with both vars named", async () => {
    expect(await getEmailHealth()).toEqual({
      configured: false,
      apiKeyPresent: false,
      apiKeyEnvVar: "RESEND_API_KEY",
      fromPresent: false,
      fromEnvVar: "EMAIL_FROM",
    });
  });

  it("reports presence and the from-domain, never the key or the mailbox", async () => {
    process.env.RESEND_API_KEY = SECRET_KEY;
    process.env.EMAIL_FROM = "FinPilot <notifications@send.ballastmoney.com>";

    const health = await getEmailHealth();
    expect(health).toEqual({
      configured: true,
      apiKeyPresent: true,
      apiKeyEnvVar: "RESEND_API_KEY",
      fromPresent: true,
      fromEnvVar: "EMAIL_FROM",
      fromValid: true,
      fromDomain: "send.ballastmoney.com",
    });

    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain(SECRET_KEY);
    // Not even a prefix, a suffix, or the length of the key.
    expect(serialized).not.toContain("re_");
    expect(serialized).not.toContain("SECRETvalue");
    expect(serialized).not.toContain(String(SECRET_KEY.length));
    // The mailbox itself stays private; only the domain is reported.
    expect(serialized).not.toContain("notifications");
    expect(serialized).not.toContain("@");
  });

  it("flags a present-but-malformed EMAIL_FROM without quoting it", async () => {
    process.env.RESEND_API_KEY = SECRET_KEY;
    process.env.EMAIL_FROM = "FinPilot notifications at ballastmoney";

    const health = await getEmailHealth();
    expect(health.fromPresent).toBe(true);
    expect(health.fromValid).toBe(false);
    expect(health.fromDomain).toBeNull();
    expect(JSON.stringify(health)).not.toContain("ballastmoney");
  });

  it("agrees with isEmailConfigured() in every combination", async () => {
    const values = [undefined, "", "re_key"];
    const froms = [undefined, "", "hi@example.com", "not-an-email"];
    for (const key of values) {
      for (const from of froms) {
        if (key === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = key;
        if (from === undefined) delete process.env.EMAIL_FROM;
        else process.env.EMAIL_FROM = from;

        const health = await getEmailHealth();
        expect(health.configured).toBe(isEmailConfigured());
        // The two presence booleans are the same condition, spelled out.
        expect(health.apiKeyPresent && health.fromPresent).toBe(health.configured);
      }
    }
  });

  it("does not call Resend unless a probe is requested", async () => {
    process.env.RESEND_API_KEY = SECRET_KEY;
    process.env.EMAIL_FROM = "hi@send.ballastmoney.com";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await getEmailHealth();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the probe when there is no key to check", async () => {
    process.env.EMAIL_FROM = "hi@send.ballastmoney.com";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const health = await getEmailHealth({ probe: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(health.keyAuthenticates).toBeUndefined();
  });

  it("lists the verified domains and confirms the from-domain matches", async () => {
    process.env.RESEND_API_KEY = SECRET_KEY;
    process.env.EMAIL_FROM = "FinPilot <notifications@send.ballastmoney.com>";
    const fetchMock = vi.fn().mockResolvedValue(
      resendDomains([
        { name: "send.ballastmoney.com", status: "verified" },
        { name: "old.ballastmoney.com", status: "pending" },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const health = await getEmailHealth({ probe: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/domains",
      expect.objectContaining({ headers: { Authorization: `Bearer ${SECRET_KEY}` } })
    );
    expect(health.keyAuthenticates).toBe(true);
    expect(health.domains).toEqual([
      { name: "send.ballastmoney.com", status: "verified" },
      { name: "old.ballastmoney.com", status: "pending" },
    ]);
    expect(health.fromDomainVerified).toBe(true);
    expect(JSON.stringify(health)).not.toContain(SECRET_KEY);
  });

  it("says the from-domain is unverified when it is pending or absent", async () => {
    process.env.RESEND_API_KEY = SECRET_KEY;
    process.env.EMAIL_FROM = "onboarding@resend.dev";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(resendDomains([{ name: "send.ballastmoney.com", status: "pending" }]))
    );

    const health = await getEmailHealth({ probe: true });
    expect(health.fromDomain).toBe("resend.dev");
    expect(health.fromDomainVerified).toBe(false);
  });

  it("reports a rejected key as a status code, without the response body", async () => {
    process.env.RESEND_API_KEY = SECRET_KEY;
    process.env.EMAIL_FROM = "hi@send.ballastmoney.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: `API key ${SECRET_KEY} is invalid` }),
      })
    );

    const health = await getEmailHealth({ probe: true });
    expect(health.keyAuthenticates).toBe(false);
    expect(health.probeError).toBe("HTTP 401");
    expect(health.domains).toBeUndefined();
    expect(JSON.stringify(health)).not.toContain(SECRET_KEY);
  });

  it("survives a network failure and a nonsense response body", async () => {
    process.env.RESEND_API_KEY = SECRET_KEY;
    process.env.EMAIL_FROM = "hi@send.ballastmoney.com";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await getEmailHealth({ probe: true })).toMatchObject({
      keyAuthenticates: false,
      probeError: "TypeError",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: "nope" }) })
    );
    expect(await getEmailHealth({ probe: true })).toMatchObject({
      keyAuthenticates: true,
      domains: [],
      fromDomainVerified: false,
    });
  });
});
