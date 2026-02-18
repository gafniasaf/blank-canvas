-- =============================================================================
-- Ignite Control Plane Schema
-- =============================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. Book Versions & Uploads
-- -----------------------------------------------------------------------------

create type book_level as enum ('n3', 'n4');

create table public.books (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  level book_level not null,
  created_at timestamptz default now()
);

-- An upload represents a raw ingestion of a book (e.g. from IDML export)
create table public.book_uploads (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid references public.books(id),
  version_tag text not null, -- e.g. "v1", "2024-10-01"
  canonical_json_url text not null, -- gs://... or https://...
  figures_map_url text, -- Optional: Map of paragraph_id -> image_url
  created_at timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- 2. Job Queue
-- -----------------------------------------------------------------------------

create type job_status as enum ('queued', 'processing', 'completed', 'failed', 'cancelled');
create type job_type as enum ('build_chapter', 'build_book', 'validate_json');

create table public.jobs (
  id uuid primary key default uuid_generate_v4(),
  type job_type not null,
  status job_status default 'queued' not null,
  
  -- Inputs (JSON blob for flexibility)
  -- Expected shape: { chapter: 1, upload_id: "...", ... }
  inputs jsonb not null default '{}'::jsonb,
  
  -- Outputs (JSON blob for results)
  -- Expected shape: { pdf_url: "...", page_count: 12, ... }
  outputs jsonb default '{}'::jsonb,
  
  -- Telemetry
  worker_id text, -- ID of the docker worker processing this
  progress_percent integer default 0,
  error_message text,
  
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- Real-time Logs
create table public.job_logs (
  id bigint generated always as identity primary key,
  job_id uuid references public.jobs(id) on delete cascade,
  level text default 'info', -- info, warn, error
  message text not null,
  timestamp timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- 3. Artifact Registry
-- -----------------------------------------------------------------------------

create type artifact_type as enum ('pdf', 'html', 'json_canonical', 'json_rewrites', 'report_layout', 'log_prince');

create table public.artifacts (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid references public.jobs(id),
  upload_id uuid references public.book_uploads(id),
  
  chapter_number integer, -- Null if book-level
  type artifact_type not null,
  
  storage_path text not null, -- Path in Supabase Storage bucket
  file_size_bytes bigint,
  
  created_at timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- 4. RLS Policies (Simplified for MVP)
-- -----------------------------------------------------------------------------

alter table public.jobs enable row level security;
alter table public.job_logs enable row level security;
alter table public.artifacts enable row level security;

-- Allow read-only access to authenticated users (Dashboard)
create policy "Allow read access for authenticated users" on public.jobs
  for select using (auth.role() = 'authenticated');

-- Allow workers (service role) full access
-- Note: Service role bypasses RLS, but explicit policies help documentation
-- create policy "Allow service role full access" ...

-- -----------------------------------------------------------------------------
-- 5. Indexes
-- -----------------------------------------------------------------------------

create index idx_jobs_status on public.jobs(status);
create index idx_job_logs_job_id on public.job_logs(job_id);
create index idx_artifacts_job_id on public.artifacts(job_id);











