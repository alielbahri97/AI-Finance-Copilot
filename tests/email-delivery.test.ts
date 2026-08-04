import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyEmailFailure, isEmailConfigured, sendEmail } from "@/lib/notifications/email";

/* ------------------------------------------------------------------ */
/* Failure classification                                              */
/* ------------------------------------------------------------------ */

describe("classifyEmailFailure", () => {
  it("detects Resend's testing-mode restriction and keeps the provider wording", () => {
    const body = JSON.stringify({
      statusCode: 403,
      name: "validation_error",
      message:
        "You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.",
    });
    const result = classifyEmailFailure(403, body);
    expect(result.status).toBe("failed");
    expect(result.domainRestricted).toBe(true);
    expect(result.error).toContain("verify a domain");
  });

  it("flags the restriction from the message alone, whatever the status code", () => {
    expect(
      classifyEmailFailure(422, JSON.stringify({ message: "The domain is not verified." }))
        .domainRestricted
    ).toBe(true);
    expect(classifyEmailFailure(400, "Please verify a domain first").domainRestricted).toBe(true);
  });

  it("treats a rejected API key as an ordinary failure, not a domain problem", () => {
    const result = classifyEmailFailure(
      401,
      JSON.stringify({ statusCode: 401, message: "API key is invalid" })
    );
    expect(result.domainRestricted).toBe(false);
    expect(result.error).toBe("API key is invalid");

    expect(
      classifyEmailFailure(403, JSON.stringify({ message: "This API key is restricted" }))
        .domainRestricted
    ).toBe(false);
  });

  it("classifies rate limiting and server errors as plain failures", () => {
    expect(classifyEmailFailure(429, JSON.stringify({ message: "Too many requests" }))).toEqual({
      status: "failed",
      error: "Too many requests",
      domainRestricted: false,
    });
    expect(classifyEmailFailure(500, "").error).toBe("Resend returned HTTP 500");
  });

  it("redacts credentials and caps the length of the provider message", () => {
    const leaky = classifyEmailFailure(
      400,
      JSON.stringify({ message: "Rejected key re_abc123DEF456ghi using Bearer re_abc123DEF456ghi" })
    );
    expect(leaky.error).toBe("Rejected key re_*** using Bearer ***");
    expect(leaky.error).not.toContain("abc123DEF456ghi");

    const long = classifyEmailFailure(400, JSON.stringify({ message: "x".repeat(600) }));
    expect(long.error).toHaveLength(300);
  });

  it("falls back to the raw body when it is not JSON", () => {
    expect(classifyEmailFailure(502, "<html>Bad gateway</html>").error).toBe(
      "<html>Bad gateway</html>"
    );
  });
});

/* ------------------------------------------------------------------ */
/* sendEmail status reporting                                          */
/* ------------------------------------------------------------------ */

describe("sendEmail", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
  });

  it("reports not_configured without calling the provider", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(isEmailConfigured()).toBe(false);
    expect(await sendEmail("partner@example.com", "Hi", "<p>Hi</p>")).toEqual({
      status: "not_configured",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still reports not_configured when only one of the two vars is set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.EMAIL_FROM;
    expect(isEmailConfigured()).toBe(false);
    expect((await sendEmail("partner@example.com", "Hi", "<p>Hi</p>")).status).toBe(
      "not_configured"
    );
  });

  it("reports sent on a 2xx response", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Ballast <hi@example.com>";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "abc" }), { status: 200 })
    );

    expect(await sendEmail("partner@example.com", "Hi", "<p>Hi</p>")).toEqual({ status: "sent" });
  });

  it("reports the domain restriction when Resend refuses the recipient", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "onboarding@resend.dev";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 403,
          message: "You can only send testing emails to your own email address.",
        }),
        { status: 403 }
      )
    );

    const result = await sendEmail("partner@example.com", "Hi", "<p>Hi</p>");
    expect(result.status).toBe("failed");
    expect(result.domainRestricted).toBe(true);
  });

  it("never throws when the network call blows up", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Ballast <hi@example.com>";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));

    expect(await sendEmail("partner@example.com", "Hi", "<p>Hi</p>")).toEqual({
      status: "failed",
      error: "fetch failed",
      domainRestricted: false,
    });
  });
});
