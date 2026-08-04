import { createHash } from "node:crypto";

/**
 * The dedupe fingerprint for transactions pulled from a bank integration.
 *
 * The basis is deliberately frozen at `"<provider>|<externalId>"`. It predates
 * multi-connection support and every row already in the database was hashed
 * this way, so widening it (to include the connection or account id) would
 * orphan those hashes and re-import everything once.
 *
 * That is safe to keep because the externalId each provider supplies is
 * already account-scoped, and an account belongs to exactly one connection:
 *
 *   - GoCardless: "<accountId>:<transactionId>" (see gocardless-core)
 *   - Plaid:      the Item-scoped transaction_id
 *   - Tink:       the globally unique transaction id
 *
 * So two connections at two banks cannot collide, and re-syncing the same
 * account still deduplicates. The uniqueness that backs this is
 * transactions(workspace_id, hash).
 */
export function bankTransactionFingerprint(provider: string, externalId: string): string {
  return createHash("sha256").update(`${provider}|${externalId}`).digest("hex");
}
