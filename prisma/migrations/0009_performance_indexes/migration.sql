-- 0009_performance_indexes
-- Stage-10 audit: indexes for query patterns not covered by earlier migrations.
-- These are raw-SQL-only (trigram/GIN indexes cannot be expressed in the
-- Prisma schema); Prisma ignores extra indexes, so the client is unaffected.

-- Trigram support for the ILIKE '%term%' searches used by transaction
-- free-text search and the invoice vendor filter. Available on Supabase by
-- default; on vanilla Postgres this requires the postgres-contrib package.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "transactions_description_trgm_idx"
  ON "transactions" USING gin ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "transactions_counterparty_trgm_idx"
  ON "transactions" USING gin ("counterparty" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "invoices_vendor_trgm_idx"
  ON "invoices" USING gin ("vendor" gin_trgm_ops);

-- AR/AP figures on /reports filter by user + direction + status; the existing
-- (user_id, status) index cannot narrow by direction.
CREATE INDEX IF NOT EXISTS "invoices_user_id_direction_status_idx"
  ON "invoices" ("user_id", "direction", "status");

-- Reports/dashboard aggregate income vs expenses within a date range; a
-- type-aware index lets Postgres skip the other side of the ledger.
CREATE INDEX IF NOT EXISTS "transactions_user_id_type_date_idx"
  ON "transactions" ("user_id", "type", "date" DESC);

-- Admin dashboard: signups-per-day chart and newest-first user listing.
CREATE INDEX IF NOT EXISTS "profiles_created_at_idx"
  ON "profiles" ("created_at");

-- Admin analytics drill-down per user (event volume by user and recency).
CREATE INDEX IF NOT EXISTS "analytics_events_user_id_created_at_idx"
  ON "analytics_events" ("user_id", "created_at");
