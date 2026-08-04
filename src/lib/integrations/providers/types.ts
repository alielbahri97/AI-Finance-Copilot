import "server-only";

import type { IntegrationConnection } from "@/generated/prisma/client";

import type { TokenSet } from "../oauth";

/** What afterConnect returns to be stored on the connection. */
export interface ConnectResult {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
  /**
   * The provider's stable id for this connection (realmId, tenantId, team id).
   * Null/absent means "the one connection this workspace has to the provider".
   */
  externalId?: string | null;
  /** Bank/organisation name for the UI, when the provider reports one. */
  institutionName?: string | null;
}

export interface SyncContext {
  connection: IntegrationConnection;
  /** The workspace the connection belongs to; all imported data lands here. */
  workspaceId: string;
  /** The member who connected the provider. */
  userId: string;
  currency: string;
  aiProvider: "OPENAI" | "ANTHROPIC" | "GROQ";
  /** Fresh decrypted access token; null for providers that mint their own. */
  accessToken: string | null;
  metadata: Record<string, unknown>;
  patchMetadata: (patch: Record<string, unknown>) => Promise<void>;
}

/** Counters recorded on the SyncRun (e.g. { imported: 12, duplicates: 3 }). */
export type SyncStats = Record<string, number>;

export interface ProviderHooks {
  /** OAuth flows: shape the exchanged tokens/metadata before storage. */
  afterConnect?: (args: {
    userId: string;
    tokens: TokenSet;
    query: Record<string, string>;
  }) => Promise<ConnectResult>;
  /** One synchronization pass. Throw IntegrationAuthError for token problems. */
  sync?: (ctx: SyncContext) => Promise<SyncStats>;
  /** Best-effort token revocation on disconnect. */
  revoke?: (connection: IntegrationConnection, accessToken: string | null) => Promise<void>;
}
