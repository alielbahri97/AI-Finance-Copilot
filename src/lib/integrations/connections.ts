import "server-only";

import type { IntegrationConnection } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { decryptSecret, encryptSecret } from "./crypto";
import { resolveConnectionTarget, type ConnectionTarget } from "./identity";
import { IntegrationAuthError, IntegrationError, refreshAccessToken, type TokenSet } from "./oauth";
import { getProvider } from "./registry";

/** Refresh tokens this long before they actually expire. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export interface SaveConnectionInput {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
  /** The provider's stable id for this connection; see IntegrationConnection. */
  externalId?: string | null;
  displayName?: string | null;
  institutionName?: string | null;
  institutionLogo?: string | null;
  /** "add" = the user explicitly asked for another connection. */
  intent?: "connect" | "add";
}

/**
 * Stores a connection, adding it alongside any existing ones for the same
 * provider rather than replacing them. Which row is written is decided by
 * resolveConnectionTarget, so the outcome matches what the unique indexes
 * allow: same provider + a different externalId adds a connection, the same
 * externalId updates in place, and providers that only support one connection
 * are re-authorized instead of duplicated.
 */
export async function saveConnection(
  scope: { workspaceId: string; userId: string },
  providerId: string,
  input: SaveConnectionInput
): Promise<IntegrationConnection> {
  const provider = getProvider(providerId);
  const externalId = input.externalId ?? null;

  const existing = await prisma.integrationConnection.findMany({
    where: { workspaceId: scope.workspaceId, provider: providerId },
    select: { id: true, externalId: true },
    orderBy: { createdAt: "asc" },
  });

  const target: ConnectionTarget = resolveConnectionTarget({
    providerName: provider?.name ?? providerId,
    multiInstance: provider?.multiInstance ?? false,
    externalId,
    existing,
    intent: input.intent,
  });
  if (target.mode === "rejected") {
    throw new IntegrationError(target.reason);
  }

  const data = {
    status: "CONNECTED" as const,
    accessToken: input.accessToken ? encryptSecret(input.accessToken) : null,
    refreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : null,
    expiresAt: input.expiresAt ?? null,
    metadata: (input.metadata ?? {}) as object,
    externalId,
    lastError: null,
    consecutiveFailures: 0,
    // Only overwrite the labels when the provider supplied fresh ones, so a
    // user-chosen displayName survives a reconnect.
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.institutionName !== undefined ? { institutionName: input.institutionName } : {}),
    ...(input.institutionLogo !== undefined ? { institutionLogo: input.institutionLogo } : {}),
  };

  if (target.mode === "update") {
    return prisma.integrationConnection.update({
      where: { id: target.connectionId },
      data: { ...data, userId: scope.userId },
    });
  }

  return prisma.integrationConnection.create({
    data: {
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      provider: providerId,
      ...data,
    },
  });
}

/**
 * The workspace's connections to a provider, oldest first. Callers that used
 * to expect at most one must now cope with several.
 */
export async function listConnections(
  workspaceId: string,
  providerId: string
): Promise<IntegrationConnection[]> {
  return prisma.integrationConnection.findMany({
    where: { workspaceId, provider: providerId },
    orderBy: { createdAt: "asc" },
  });
}

export type ConnectionLookup =
  | { ok: true; connection: IntegrationConnection }
  | { ok: false; status: number; error: string };

/**
 * Resolves the connection an API request is about. A workspace with several
 * connections to one provider must say which — guessing would sync or
 * disconnect the wrong bank.
 */
export async function lookupRequestedConnection(
  workspaceId: string,
  providerId: string,
  connectionId?: string | null
): Promise<ConnectionLookup> {
  const connections = await listConnections(workspaceId, providerId);
  if (connections.length === 0) {
    return { ok: false, status: 404, error: "Not connected" };
  }
  if (!connectionId) {
    if (connections.length > 1) {
      return {
        ok: false,
        status: 400,
        error: "Several connections exist for this provider — pick which one to act on.",
      };
    }
    return { ok: true, connection: connections[0] };
  }
  const match = connections.find((connection) => connection.id === connectionId);
  if (!match) {
    return { ok: false, status: 404, error: "Connection not found" };
  }
  return { ok: true, connection: match };
}

export function connectionMetadata(connection: IntegrationConnection): Record<string, unknown> {
  return (connection.metadata as Record<string, unknown> | null) ?? {};
}

/** Shallow-merges a patch into the connection metadata. */
export async function patchMetadata(
  connectionId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const current = await prisma.integrationConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { metadata: true },
  });
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: {
      metadata: {
        ...((current.metadata as Record<string, unknown> | null) ?? {}),
        ...patch,
      } as object,
    },
  });
}

/**
 * Returns a valid decrypted access token for the connection, refreshing it
 * through the provider's token endpoint when close to expiry. A failed
 * refresh marks the connection EXPIRED and throws IntegrationAuthError.
 */
export async function getFreshAccessToken(
  connection: IntegrationConnection
): Promise<string> {
  if (!connection.accessToken) {
    throw new IntegrationAuthError("Connection has no stored token");
  }
  const needsRefresh =
    connection.expiresAt !== null &&
    connection.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;

  if (!needsRefresh) {
    return decryptSecret(connection.accessToken);
  }

  if (!connection.refreshToken) {
    await markExpired(connection.id, "Access token expired and no refresh token is stored");
    throw new IntegrationAuthError("Access token expired; reconnect required");
  }

  const provider = getProvider(connection.provider);
  if (!provider?.oauth) {
    // Non-OAuth providers manage token lifetimes themselves.
    return decryptSecret(connection.accessToken);
  }

  try {
    const tokens = await refreshAccessToken(provider, decryptSecret(connection.refreshToken));
    await storeTokens(connection.id, tokens);
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof IntegrationAuthError) {
      await markExpired(connection.id, error.message);
    }
    throw error;
  }
}

export async function storeTokens(connectionId: string, tokens: TokenSet): Promise<void> {
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: {
      accessToken: encryptSecret(tokens.accessToken),
      refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : undefined,
      expiresAt: tokens.expiresAt,
      status: "CONNECTED",
    },
  });
}

export async function markExpired(connectionId: string, reason: string): Promise<void> {
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: { status: "EXPIRED", lastError: reason.slice(0, 500) },
  });
}
