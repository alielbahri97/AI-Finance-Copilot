import { describe, expect, it } from "vitest";

import { BRAND } from "@/lib/branding";
import {
  APP_URL_SPEC,
  EnvUrlError,
  resolveAppUrl,
  urlEnvIssue,
  URL_ENV_VARS,
  validateUrlEnv,
} from "@/lib/env-url";

/**
 * Regression cover for the failure that motivated this module: a space typed
 * instead of a dot in NEXT_PUBLIC_APP_URL took a production build down with
 * "TypeError: Invalid URL" / "Failed to collect page data for /_not-found",
 * naming neither the variable nor the value.
 */

const SPEC = (name: string) => {
  const spec = URL_ENV_VARS.find((candidate) => candidate.name === name);
  if (!spec) throw new Error(`No URL spec registered for ${name}`);
  return spec;
};

describe("urlEnvIssue", () => {
  it("names the variable and echoes the value when a space sneaks in", () => {
    const issue = urlEnvIssue(APP_URL_SPEC, "https://app ballastmoney.com");
    expect(issue).toContain('NEXT_PUBLIC_APP_URL is not a valid URL: "https://app ballastmoney.com"');
    expect(issue).toContain("space");
  });

  it("names the variable for a value that is not a URL at all", () => {
    expect(urlEnvIssue(APP_URL_SPEC, "app.ballastmoney.com")).toContain(
      'NEXT_PUBLIC_APP_URL is not a valid URL: "app.ballastmoney.com"'
    );
  });

  it("suggests the expected shape of the value", () => {
    expect(urlEnvIssue(APP_URL_SPEC, "nonsense")).toContain(`https://app.${BRAND.domain}`);
  });

  it("rejects a scheme the variable does not accept", () => {
    const issue = urlEnvIssue(APP_URL_SPEC, "postgres://localhost:5432/app");
    expect(issue).toContain("must start with http:// or https://");
  });

  it("accepts a well-formed value, with or without surrounding whitespace", () => {
    expect(urlEnvIssue(APP_URL_SPEC, "https://app.ballastmoney.com")).toBeNull();
    expect(urlEnvIssue(APP_URL_SPEC, "  https://app.ballastmoney.com  ")).toBeNull();
  });

  it("treats unset and empty as fine — absence is a different check", () => {
    expect(urlEnvIssue(APP_URL_SPEC, undefined)).toBeNull();
    expect(urlEnvIssue(APP_URL_SPEC, "   ")).toBeNull();
  });

  it("requires a Postgres scheme for connection strings", () => {
    expect(urlEnvIssue(SPEC("DATABASE_URL"), "postgresql://u:p@host:5432/db")).toBeNull();
    expect(urlEnvIssue(SPEC("DATABASE_URL"), "https://host:5432/db")).toContain(
      "must start with postgres:// or postgresql://"
    );
  });
});

describe("validateUrlEnv", () => {
  it("reports every offender, and stays quiet on a clean environment", () => {
    const issues = validateUrlEnv({
      NEXT_PUBLIC_APP_URL: "https://app ballastmoney.com",
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      DATABASE_URL: "postgresql://u:p@host:5432/db",
    });

    expect(issues).toHaveLength(2);
    expect(issues.join("\n")).toContain("NEXT_PUBLIC_APP_URL");
    expect(issues.join("\n")).toContain("NEXT_PUBLIC_SUPABASE_URL");

    expect(validateUrlEnv({ DATABASE_URL: "postgres://u:p@host:5432/db" })).toEqual([]);
  });
});

describe("resolveAppUrl", () => {
  it("falls back to localhost outside production", () => {
    expect(resolveAppUrl(undefined, false)).toBe("http://localhost:3000");
  });

  it("falls back to the canonical app origin in production", () => {
    expect(resolveAppUrl(undefined, true)).toBe(BRAND.appUrl);
  });

  it("trims whitespace and drops a trailing slash", () => {
    expect(resolveAppUrl("  https://app.ballastmoney.com/  ", true)).toBe(
      "https://app.ballastmoney.com"
    );
  });

  it("throws a named EnvUrlError rather than a bare TypeError", () => {
    expect(() => resolveAppUrl("https://app ballastmoney.com", true)).toThrow(EnvUrlError);
    expect(() => resolveAppUrl("https://app ballastmoney.com", true)).toThrow(
      /NEXT_PUBLIC_APP_URL is not a valid URL/
    );
  });

  it("produces a value that new URL() accepts, which is what metadataBase needs", () => {
    expect(() => new URL(resolveAppUrl(undefined, true))).not.toThrow();
    expect(() => new URL(resolveAppUrl("https://app.ballastmoney.com", true))).not.toThrow();
  });
});
