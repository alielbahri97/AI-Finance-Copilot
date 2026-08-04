import { BRAND } from "@/lib/branding";

/**
 * Validation for URL-typed environment variables.
 *
 * These get their own pass because a malformed one used to fail deep inside
 * Next's metadata generation as a bare `TypeError: Invalid URL` / "Failed to
 * collect page data for /_not-found", naming neither the variable nor the
 * value — a single mistyped space in NEXT_PUBLIC_APP_URL cost a production
 * build. Every message here names the variable and echoes what it was set to.
 *
 * Kept separate from `env.ts` so client components can resolve the app origin
 * without pulling in the server-side schema.
 */

export interface UrlEnvSpec {
  name: string;
  /** Allowed URL schemes. A value with any other scheme is rejected by name. */
  protocols: string[];
  /** Shown in the error so the fix is obvious without opening the docs. */
  example: string;
}

const WEB_PROTOCOLS = ["http:", "https:"];
const POSTGRES_PROTOCOLS = ["postgres:", "postgresql:"];
const POSTGRES_EXAMPLE = "postgresql://user:password@host:5432/database";

export const APP_URL_SPEC: UrlEnvSpec = {
  name: "NEXT_PUBLIC_APP_URL",
  protocols: WEB_PROTOCOLS,
  example: `https://app.${BRAND.domain}`,
};

/** Every environment variable that must parse as a URL when it is set. */
export const URL_ENV_VARS: readonly UrlEnvSpec[] = [
  APP_URL_SPEC,
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    protocols: WEB_PROTOCOLS,
    example: "https://your-project.supabase.co",
  },
  {
    name: "NEXT_PUBLIC_ISSUES_URL",
    protocols: WEB_PROTOCOLS,
    example: "https://github.com/owner/repo/issues/new",
  },
  { name: "DATABASE_URL", protocols: POSTGRES_PROTOCOLS, example: POSTGRES_EXAMPLE },
  { name: "DIRECT_URL", protocols: POSTGRES_PROTOCOLS, example: POSTGRES_EXAMPLE },
];

/** Thrown for a malformed URL-typed variable, so callers can tell it apart. */
export class EnvUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvUrlError";
  }
}

function describeProtocols(protocols: string[]): string {
  return protocols.map((protocol) => `${protocol}//`).join(" or ");
}

/**
 * Validates one URL-typed value. Returns the problem as a sentence, or null
 * when the value is absent (every URL variable is optional to *this* check) or
 * well formed.
 */
export function urlEnvIssue(spec: UrlEnvSpec, rawValue: string | undefined): string | null {
  const value = rawValue?.trim();
  if (!value) return null;

  // The URL parser silently tolerates surrounding whitespace and rejects
  // interior whitespace with an opaque error, so name that case explicitly —
  // it is the mistake that actually happened.
  if (/\s/.test(value)) {
    return `${spec.name} is not a valid URL: "${rawValue}" — it contains a space, which is usually a mistyped "." or "/".`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${spec.name} is not a valid URL: "${rawValue}" — expected something like ${spec.example}.`;
  }

  if (!spec.protocols.includes(parsed.protocol)) {
    return `${spec.name} is not a valid URL: "${rawValue}" — it must start with ${describeProtocols(spec.protocols)}.`;
  }

  return null;
}

type EnvLike = Readonly<Record<string, string | undefined>>;

/** Collects every URL-typed problem in the given environment. */
export function validateUrlEnv(env: EnvLike): string[] {
  return URL_ENV_VARS.map((spec) => urlEnvIssue(spec, env[spec.name])).filter(
    (issue): issue is string => issue !== null
  );
}

/** Throws a named, quoted error listing every malformed URL variable. */
export function assertValidUrlEnv(env: EnvLike): void {
  const issues = validateUrlEnv(env);
  if (issues.length > 0) {
    throw new EnvUrlError(issues.join("\n"));
  }
}

const DEV_APP_URL = "http://localhost:3000";

/**
 * Resolves a public origin from a raw NEXT_PUBLIC_APP_URL value.
 *
 * Unset falls back sanely, so local development and preview builds never need
 * the variable. A *set but malformed* value throws by name: that is a real
 * misconfiguration, and failing the build loudly beats shipping a site whose
 * canonical URLs, auth redirects and email links point nowhere.
 */
export function resolveAppUrl(rawValue: string | undefined, isProduction: boolean): string {
  const value = rawValue?.trim();
  if (!value) return isProduction ? BRAND.appUrl : DEV_APP_URL;
  const issue = urlEnvIssue(APP_URL_SPEC, rawValue);
  if (issue) throw new EnvUrlError(issue);
  return value.replace(/\/$/, "");
}

/**
 * The public origin of this deployment, without a trailing slash.
 *
 * Reads `process.env` members literally so the bundler can inline them into
 * client code.
 */
export function getAppUrl(): string {
  return resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL, process.env.NODE_ENV === "production");
}
