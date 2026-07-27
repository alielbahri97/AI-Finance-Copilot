import "server-only";

import type { IntegrationProvider, OAuthConfig } from "./registry";

/** Normalized token endpoint response. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Absolute expiry; null when the provider did not send expires_in. */
  expiresAt: Date | null;
  /** The full raw response for provider-specific hooks (Slack webhook, etc). */
  raw: Record<string, unknown>;
}

export class IntegrationError extends Error {}

/** Auth-level failure: token invalid/revoked; connection should go EXPIRED. */
export class IntegrationAuthError extends IntegrationError {}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function redirectUri(providerId: string): string {
  return `${appUrl()}/api/integrations/${providerId}/callback`;
}

function requireOAuth(provider: IntegrationProvider): OAuthConfig {
  if (!provider.oauth) {
    throw new IntegrationError(`${provider.name} does not use the OAuth2 flow`);
  }
  return provider.oauth;
}

export function buildAuthUrl(provider: IntegrationProvider, state: string): string {
  const oauth = requireOAuth(provider);
  const url = new URL(oauth.authUrl);
  url.searchParams.set("client_id", process.env[oauth.clientIdEnv] ?? "");
  url.searchParams.set("redirect_uri", redirectUri(provider.id));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (oauth.scopes.length > 0) {
    url.searchParams.set("scope", oauth.scopes.join(" "));
  }
  for (const [key, value] of Object.entries(oauth.extraAuthParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function tokenRequest(
  provider: IntegrationProvider,
  params: Record<string, string>
): Promise<TokenSet> {
  const oauth = requireOAuth(provider);
  const clientId = process.env[oauth.clientIdEnv] ?? "";
  const clientSecret = process.env[oauth.clientSecretEnv] ?? "";

  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (oauth.tokenAuth === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  }

  const response = await fetch(oauth.tokenUrl, { method: "POST", headers, body });
  const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok || raw.error || raw.ok === false) {
    const detail =
      (raw.error_description as string) ||
      (raw.error as string) ||
      `HTTP ${response.status}`;
    const authFailure =
      response.status === 400 || response.status === 401 || Boolean(raw.error);
    const message = `${provider.name} token request failed: ${detail}`;
    throw authFailure ? new IntegrationAuthError(message) : new IntegrationError(message);
  }

  const accessToken = raw.access_token as string | undefined;
  if (!accessToken) {
    throw new IntegrationAuthError(`${provider.name} token response had no access_token`);
  }
  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : null;

  return {
    accessToken,
    refreshToken: (raw.refresh_token as string | undefined) ?? null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    raw,
  };
}

export async function exchangeCode(
  provider: IntegrationProvider,
  code: string
): Promise<TokenSet> {
  return tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider.id),
  });
}

export async function refreshAccessToken(
  provider: IntegrationProvider,
  refreshToken: string
): Promise<TokenSet> {
  const tokens = await tokenRequest(provider, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  // Providers that don't rotate refresh tokens omit them from the response.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}
