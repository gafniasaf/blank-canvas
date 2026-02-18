-- BookGen: book_registry table
-- Replaces the local books/manifest.json with a cloud-first source of truth.

CREATE TABLE IF NOT EXISTS book_registry (
  book_id         TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  isbn            TEXT,
  level           TEXT NOT NULL CHECK (level IN ('n3', 'n4')),
  language        TEXT NOT NULL DEFAULT 'nl',
  chapters        INT[] NOT NULL DEFAULT '{}',
  canonical_idml  TEXT,                        -- Storage path to IDML snapshot
  template_profile JSONB DEFAULT '{}',         -- inline design token overrides
  upload_id       UUID,                        -- legacy link to old DB content table
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ingesting', 'generating', 'complete', 'failed')),
  config          JSONB NOT NULL DEFAULT '{}', -- per-book overrides (microheadingDensity, model, etc.)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION bookgen_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_book_registry_updated ON book_registry;
CREATE TRIGGER trg_book_registry_updated
  BEFORE UPDATE ON book_registry
  FOR EACH ROW EXECUTE FUNCTION bookgen_set_updated_at();

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_book_registry_status ON book_registry(status);

