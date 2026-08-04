-- Extraction telemetry: which provider/model handled a document, how long it
-- took, why it failed (shown on the review page), arithmetic warnings and
-- per-field confidence for review highlighting. All nullable — existing rows
-- simply have no telemetry.

ALTER TABLE "invoices"
  ADD COLUMN "extraction_provider"    TEXT,
  ADD COLUMN "extraction_model"       TEXT,
  ADD COLUMN "extraction_duration_ms" INTEGER,
  ADD COLUMN "extraction_reason"      TEXT,
  ADD COLUMN "extraction_warnings"    JSONB,
  ADD COLUMN "extraction_confidence"  JSONB;
