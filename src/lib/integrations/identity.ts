/**
 * How a workspace's connections to one provider are told apart, and which of
 * them a new connect attempt should land on. Pure so the rules can be tested
 * without a database — and written to mirror exactly what the indexes added in
 * 0016_multi_bank_connections enforce:
 *
 *   UNIQUE (workspace_id, provider, external_id)
 *   UNIQUE (workspace_id, provider) WHERE external_id IS NULL   [partial]
 *
 * Together those mean: any number of connections per provider as long as each
 * carries a distinct externalId, plus at most one without one.
 */

export interface ExistingConnection {
  id: string;
  externalId: string | null;
}

export type ConnectionTarget =
  /** Re-point an existing row (re-authorization, consent renewal). */
  | { mode: "update"; connectionId: string }
  /** Add a connection alongside the existing ones. */
  | { mode: "create" }
  /** Refused: the provider does not support a second connection. */
  | { mode: "rejected"; reason: string };

export interface ResolveTargetInput {
  /** Human-readable provider name, used in the rejection message. */
  providerName: string;
  /** From the registry: can this provider hold several connections? */
  multiInstance: boolean;
  /** The provider's stable id for the connection being made, if any. */
  externalId: string | null;
  /** This workspace's existing connections to the same provider. */
  existing: ExistingConnection[];
  /**
   * "add" means the user explicitly asked for another connection ("Connect
   * another bank"); "connect" is the ordinary entry point, where an existing
   * single-instance connection is simply re-authorized.
   */
  intent?: "connect" | "add";
}

/**
 * The row a save should target. NULL-aware matching is deliberate: because of
 * the partial unique index, a NULL externalId can only ever match the single
 * anonymous row, so treating null === null here is the same decision the
 * database would make.
 */
export function resolveConnectionTarget(input: ResolveTargetInput): ConnectionTarget {
  const { providerName, multiInstance, externalId, existing, intent = "connect" } = input;

  const match = existing.find((connection) => connection.externalId === externalId);
  if (match) {
    return { mode: "update", connectionId: match.id };
  }

  if (!multiInstance && existing.length > 0) {
    if (intent === "add") {
      return { mode: "rejected", reason: multiInstanceRefusal(providerName) };
    }
    // Reconnecting a single-instance provider replaces what is there, which is
    // what re-authorizing Slack or a mailbox means.
    return { mode: "update", connectionId: existing[0].id };
  }

  return { mode: "create" };
}

/**
 * Whether adding one more connection to this provider is allowed at all —
 * the check the "Connect another" entry points make before starting a flow.
 */
export function canAddConnection(multiInstance: boolean, existingCount: number): boolean {
  return multiInstance || existingCount === 0;
}

/** The message shown when a single-instance provider is asked for a second connection. */
export function multiInstanceRefusal(providerName: string): string {
  return `${providerName} supports one connection per workspace. Disconnect the existing one first, or reconnect it to update it.`;
}
