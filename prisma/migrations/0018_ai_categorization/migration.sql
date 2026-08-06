-- 0018_ai_categorization
-- Adds AI categorization of imported transactions.
--
-- Plan:
--   1. A per-workspace opt-out. Default true, because the feature is the
--      point of the import pipeline getting smarter; a workspace that would
--      rather no model looked at its descriptions turns it off in Settings.
--   2. A usage counter per workspace and period, alongside the existing
--      ai_messages / csv_imports / invoice_extractions counters, so the Free
--      tier's monthly row allowance can be enforced the same way everything
--      else is.
--
-- Two NOT NULL columns with constant defaults, nothing else. No data is read,
-- written or moved, and code that predates this migration is unaffected by
-- either column.

ALTER TABLE "workspaces"
  ADD COLUMN "ai_categorization_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "usage_records"
  ADD COLUMN "ai_categorizations" INTEGER NOT NULL DEFAULT 0;
