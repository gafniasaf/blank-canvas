-- BookGen: pipeline_jobs table
-- Postgres-based job queue using FOR UPDATE SKIP LOCKED claim pattern.

CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id         TEXT NOT NULL REFERENCES book_registry(book_id) ON DELETE CASCADE,
  chapter         INT,                         -- NULL for book-level jobs
  section         TEXT,                        -- e.g. "1.1" for section-level jobs
  step            TEXT NOT NULL,               -- see CHECK below
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'claimed', 'running', 'done', 'failed', 'cancelled')),
  worker_id       TEXT,                        -- Fly machine ID or "local-dev"
  priority        INT NOT NULL DEFAULT 0,      -- higher = picked sooner
  depends_on      UUID[],                      -- job IDs that must be 'done' first
  input_artifacts JSONB NOT NULL DEFAULT '{}', -- Storage paths to inputs
  output_artifacts JSONB NOT NULL DEFAULT '{}',-- Storage paths to outputs
  error           TEXT,
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 3,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT valid_step CHECK (step IN (
    'ingest_book',
    'extract_tokens',
    'export_canonical',
    'extract_skeleton',
    'generate_section',
    'assemble_chapter',
    'generate_figures',
    'generate_ai_images',
    'inject_existing_figures',
    'generate_chapter_recap',
    'apply_boxes',
    'apply_errata',
    'apply_microfix',
    'render_chapter_pdf',
    'assemble_book',
    'generate_index',
    'generate_glossary',
    'normalize_voice',
    'render_book_pdf',
    'validate_book'
  ))
);

-- Index for the claim query (pending jobs, ordered by priority)
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_claim
  ON pipeline_jobs(status, priority DESC, created_at ASC)
  WHERE status = 'pending';

-- Index for dependency checks
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_book_step
  ON pipeline_jobs(book_id, chapter, step);

-- Keep updated_at fresh
DROP TRIGGER IF EXISTS trg_pipeline_jobs_updated ON pipeline_jobs;
CREATE TRIGGER trg_pipeline_jobs_updated
  BEFORE UPDATE ON pipeline_jobs
  FOR EACH ROW EXECUTE FUNCTION bookgen_set_updated_at();

-- =============================================================================
-- RPC: claim the next pending job (FOR UPDATE SKIP LOCKED)
-- =============================================================================
CREATE OR REPLACE FUNCTION claim_next_pipeline_job(p_worker_id TEXT)
RETURNS SETOF pipeline_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  v_job pipeline_jobs;
BEGIN
  -- Find the highest-priority pending job whose dependencies are all done
  SELECT j.* INTO v_job
  FROM pipeline_jobs j
  WHERE j.status = 'pending'
    AND j.attempts < j.max_attempts
    AND (
      j.depends_on IS NULL
      OR j.depends_on = '{}'
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(j.depends_on) AS dep_id
        JOIN pipeline_jobs dj ON dj.id = dep_id
        WHERE dj.status <> 'done'
      )
    )
  ORDER BY j.priority DESC, j.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job.id IS NULL THEN
    RETURN;
  END IF;

  -- Claim it
  UPDATE pipeline_jobs
  SET status = 'claimed',
      worker_id = p_worker_id,
      started_at = now(),
      attempts = attempts + 1,
      updated_at = now()
  WHERE id = v_job.id;

  v_job.status := 'claimed';
  v_job.worker_id := p_worker_id;
  v_job.started_at := now();
  v_job.attempts := v_job.attempts + 1;

  RETURN NEXT v_job;
END;
$$;

