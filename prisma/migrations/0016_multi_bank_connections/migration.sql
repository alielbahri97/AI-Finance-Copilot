-- 0016_multi_bank_connections
-- A business commonly banks in more than one place (ING current account plus a
-- Rabobank savings account). Until now integration_connections carried a
-- UNIQUE (workspace_id, provider), so the second bank was rejected outright.
--
-- Plan:
--   1. Identify a connection by the provider's own stable id (external_id):
--      GoCardless institution id, Plaid item id, QuickBooks realmId, Xero
--      tenantId, Exact division. Backfilled from metadata where derivable.
--   2. Replace UNIQUE (workspace_id, provider) with
--      UNIQUE (workspace_id, provider, external_id) plus a PARTIAL unique
--      index for the external_id IS NULL case (see the note below).
--   3. Add the labelling columns the UI needs to tell connections apart
--      (display_name, institution_name, institution_logo).
--   4. Add bank_accounts: one row per account inside a connection, with the
--      latest balance snapshot and an include_in_totals switch. Existing
--      per-account data living in GoCardless connection metadata is migrated
--      into it.
--
-- Nothing here touches transactions, so imported rows and their dedupe
-- fingerprints are untouched by design: the fingerprint basis stays
-- sha256("<provider>|<externalId>") and every bank provider's externalId is
-- already account-scoped, which is what keeps two connections from colliding.

-- --------------------------------------------------------- 1. new columns

ALTER TABLE "integration_connections"
  ADD COLUMN "external_id"      TEXT,
  ADD COLUMN "display_name"     TEXT,
  ADD COLUMN "institution_name" TEXT,
  ADD COLUMN "institution_logo" TEXT;

-- Backfill the connection identity from what each provider already stored.
-- GoCardless keys on the institution rather than the requisition: renewing
-- consent mints a fresh requisition for the same bank and must update the
-- existing row instead of adding a duplicate bank.
UPDATE "integration_connections"
   SET "external_id" = NULLIF("metadata"->>'institutionId', ''),
       "institution_name" = NULLIF("metadata"->>'institutionName', '')
 WHERE "provider" = 'gocardless';

UPDATE "integration_connections"
   SET "external_id" = NULLIF("metadata"->>'itemId', ''),
       "institution_name" = NULLIF("metadata"->>'institution', '')
 WHERE "provider" = 'plaid';

UPDATE "integration_connections"
   SET "external_id" = NULLIF("metadata"->>'realmId', '')
 WHERE "provider" = 'quickbooks';

UPDATE "integration_connections"
   SET "external_id" = NULLIF("metadata"->>'tenantId', ''),
       "institution_name" = NULLIF("metadata"->>'tenantName', '')
 WHERE "provider" = 'xero';

UPDATE "integration_connections"
   SET "external_id" = NULLIF("metadata"->>'division', '')
 WHERE "provider" = 'exact';

-- Everything else (Slack, Teams, Gmail, Outlook, Google Calendar, Tink) keeps
-- external_id NULL: one connection per workspace is the whole intent there,
-- and the partial index below enforces it.

-- ------------------------------------------------------ 2. uniqueness swap

DROP INDEX IF EXISTS "integration_connections_workspace_id_provider_key";

CREATE UNIQUE INDEX "integration_connections_workspace_id_provider_external_id_key"
    ON "integration_connections"("workspace_id", "provider", "external_id");

-- Postgres treats NULLs as distinct, so the index above would happily accept
-- an unbounded number of external_id-less rows for the same provider — which
-- is exactly the accidental duplicate we are trying to prevent for
-- single-instance providers and for legacy rows we could not key. A partial
-- unique index closes that hole without constraining the genuine multi-bank
-- case. (Prisma cannot express partial indexes; the schema documents it.)
CREATE UNIQUE INDEX "integration_connections_workspace_provider_null_key"
    ON "integration_connections"("workspace_id", "provider")
 WHERE "external_id" IS NULL;

CREATE INDEX "integration_connections_workspace_id_provider_idx"
    ON "integration_connections"("workspace_id", "provider");

-- --------------------------------------------------------- 3. bank_accounts

CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "name" TEXT,
    "mask" TEXT,
    "currency" TEXT,
    "include_in_totals" BOOLEAN NOT NULL DEFAULT true,
    "last_balance" DECIMAL(14,2),
    "last_balance_at" TIMESTAMP(3),
    "balance_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_accounts_connection_id_external_account_id_key"
    ON "bank_accounts"("connection_id", "external_account_id");

ALTER TABLE "bank_accounts"
    ADD CONSTRAINT "bank_accounts_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate the per-account data GoCardless syncs had been keeping in metadata:
-- metadata.accounts is the account-id list, metadata.accountLabels the
-- positionally matching IBAN tails, metadata.balances a map keyed by account id
-- ({ amount, currency, type, at }). Ids are derived so re-running is a no-op.
INSERT INTO "bank_accounts" (
    "id", "connection_id", "external_account_id", "mask", "currency",
    "include_in_totals", "last_balance", "last_balance_at", "balance_type",
    "created_at", "updated_at"
)
SELECT
    'bac-' || md5(c."id" || ':' || account."value"),
    c."id",
    account."value",
    NULLIF(c."metadata"->'accountLabels'->>((account."position" - 1)::int), 'account'),
    c."metadata"->'balances'->account."value"->>'currency',
    true,
    NULLIF(c."metadata"->'balances'->account."value"->>'amount', '')::numeric,
    NULLIF(c."metadata"->'balances'->account."value"->>'at', '')::timestamp,
    c."metadata"->'balances'->account."value"->>'type',
    c."created_at",
    CURRENT_TIMESTAMP
FROM "integration_connections" c
CROSS JOIN LATERAL jsonb_array_elements_text(c."metadata"->'accounts')
    WITH ORDINALITY AS account("value", "position")
WHERE c."provider" = 'gocardless'
  AND jsonb_typeof(c."metadata"->'accounts') = 'array'
ON CONFLICT DO NOTHING;
