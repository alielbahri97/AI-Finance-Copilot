import "server-only";

import type { IntegrationConnection } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { decryptSecret, encryptSecret } from "./crypto";
import { IntegrationAuthError, refreshAccessToken, type TokenSet } from "./oauth";
import { getProvider } from "./registry";

/** Refresh tokens this long before they actually expire. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export interface SaveConnectionInput {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

/** Creates or replaces a user's connection to a provider (status CONNECTED). */
export async function saveConnection(
  userId: string,
  providerId: string,
  input: SaveConnectionInput
): Promise<IntegrationConnection> {
  const data = {
    status: "CONNECTED" as const,
    accessToken: input.accessToken ? encryptSecret(input.accessToken) : null,
    refreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : null,
    expiresAt: input.expiresAt ?? null,
    metadata: (input.metadata ?? {}) as object,
    lastError: null,
    consecutiveFailures: 0,
  };
  return prisma.integrationConnection.upsert({
    where: { userId_provider: { userId, provider: providerId } },
    update: data,
    create: { userId, provider: providerId, ...data },
  });
}

export async function getConnection(
  userId: string,
  providerId: string
): Promise<IntegrationConnection | null> {
  return prisma.integrationConnection.findUnique({
    where: { userId_provider: { userId, provider: providerId } },
  });
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
