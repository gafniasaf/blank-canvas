-- pgvector & canonical content schema
CREATE EXTENSION IF NOT EXISTS vector;

-- Main canonical content table
CREATE TABLE IF NOT EXISTS content (
  id            BIGSERIAL PRIMARY KEY,
  content_id    TEXT UNIQUE NOT NULL,      -- stable ID, e.g. book1_ch3_p12
  book          TEXT,
  chapter       TEXT,
  section       TEXT,
  topic         TEXT,
  source_text   TEXT NOT NULL,             -- raw/extracted text
  validated_text TEXT,                     -- rewritten/approved text
  status        TEXT NOT NULL DEFAULT 'raw' CHECK (status IN ('raw','validated','approved','rejected')),
  metadata      JSONB NOT NULL DEFAULT '{}',
  embedding     vector(1536),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Versioned text history
CREATE TABLE IF NOT EXISTS content_versions (
  id            BIGSERIAL PRIMARY KEY,
  content_id    TEXT NOT NULL REFERENCES content(content_id) ON DELETE CASCADE,
  version       INT  NOT NULL DEFAULT 1,
  text          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS content_versions_content_id_version_idx
  ON content_versions(content_id, version);

-- Vector index for semantic search (adjust lists to data size)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'content_embedding_ivfflat_idx'
  ) THEN
    EXECUTE 'CREATE INDEX content_embedding_ivfflat_idx ON content USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);';
  END IF;
END
$$;

-- Helpful secondary indexes
CREATE INDEX IF NOT EXISTS content_book_content_id_idx ON content(book, content_id);
CREATE INDEX IF NOT EXISTS content_status_idx ON content(status);
CREATE INDEX IF NOT EXISTS content_metadata_gin_idx ON content USING GIN (metadata);

-- Timestamp trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_content'
  ) THEN
    CREATE TRIGGER set_updated_at_content
    BEFORE UPDATE ON content
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

