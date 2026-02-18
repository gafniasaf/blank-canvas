-- BookGen: pipeline_events table
-- Append-only event log for progress tracking + heartbeat.
-- Powers realtime dashboard subscriptions.

CREATE TABLE IF NOT EXISTS pipeline_events (
  id          BIGSERIAL PRIMARY KEY,
  job_id      UUID NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  book_id     TEXT NOT NULL,
  event_type  TEXT NOT NULL,                -- 'progress' | 'heartbeat' | 'log' | 'error' | 'done'
  progress    INT,                          -- 0-100 percentage (NULL for non-progress events)
  message     TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying events by job
CREATE INDEX IF NOT EXISTS idx_pipeline_events_job
  ON pipeline_events(job_id, created_at DESC);

-- Index for book-level event streams (dashboard)
CREATE INDEX IF NOT EXISTS idx_pipeline_events_book
  ON pipeline_events(book_id, created_at DESC);

-- =============================================================================
-- RPC: emit a pipeline event (convenience wrapper)
-- =============================================================================
CREATE OR REPLACE FUNCTION emit_pipeline_event(
  p_job_id     UUID,
  p_book_id    TEXT,
  p_event_type TEXT,
  p_progress   INT DEFAULT NULL,
  p_message    TEXT DEFAULT NULL,
  p_metadata   JSONB DEFAULT '{}'
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO pipeline_events (job_id, book_id, event_type, progress, message, metadata)
  VALUES (p_job_id, p_book_id, p_event_type, p_progress, p_message, p_metadata)
  RETURNING id INTO v_id;

  -- Also update the job's updated_at for heartbeat detection
  UPDATE pipeline_jobs SET updated_at = now() WHERE id = p_job_id;

  RETURN v_id;
END;
$$;

-- =============================================================================
-- Enable Realtime on pipeline_events for dashboard subscriptions
-- =============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_events;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_jobs;

