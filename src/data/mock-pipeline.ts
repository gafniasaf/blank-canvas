import type { Book, PipelineJob, PipelineEvent } from "@/types/pipeline";

export const MOCK_BOOKS: Book[] = [
  { book_id: "b1", title: "Rekenen & Wiskunde N3", level: "n3", status: "active", created_at: "2026-01-15T10:00:00Z" },
  { book_id: "b2", title: "Communicatie N4", level: "n4", status: "active", created_at: "2026-01-20T14:30:00Z" },
  { book_id: "b3", title: "Anatomie & Fysiologie", level: "n4", status: "draft", created_at: "2026-02-01T09:00:00Z" },
];

export const MOCK_JOBS: PipelineJob[] = [
  { id: "j1", book_id: "b1", step: "generate_content", chapter: 1, status: "done", attempts: 1, created_at: "2026-02-17T08:00:00Z", updated_at: "2026-02-17T08:12:00Z", completed_at: "2026-02-17T08:12:00Z" },
  { id: "j2", book_id: "b1", step: "assemble_chapter", chapter: 1, status: "running", attempts: 1, created_at: "2026-02-17T08:12:00Z", updated_at: "2026-02-17T08:15:00Z", started_at: "2026-02-17T08:12:30Z" },
  { id: "j3", book_id: "b2", step: "render_pdf", chapter: null, status: "failed", attempts: 3, error: "PrinceXML timeout after 120s", created_at: "2026-02-16T22:00:00Z", updated_at: "2026-02-17T01:00:00Z" },
  { id: "j4", book_id: "b1", step: "validate_layout", chapter: 2, status: "pending", attempts: 0, created_at: "2026-02-17T08:15:00Z", updated_at: "2026-02-17T08:15:00Z" },
  { id: "j5", book_id: "b3", step: "extract_tokens", chapter: null, status: "pending", attempts: 0, created_at: "2026-02-18T06:00:00Z", updated_at: "2026-02-18T06:00:00Z" },
];

export const MOCK_EVENTS: PipelineEvent[] = [
  { id: "e1", job_id: "j1", book_id: "b1", kind: "done", progress: 100, message: "generate_content completed", created_at: "2026-02-17T08:12:00Z" },
  { id: "e2", job_id: "j2", book_id: "b1", kind: "progress", progress: 45, message: "Assembling chapter 1 — 12/27 sections", created_at: "2026-02-17T08:14:00Z" },
  { id: "e3", job_id: "j3", book_id: "b2", kind: "error", progress: null, message: "PrinceXML timeout after 120s", created_at: "2026-02-17T01:00:00Z" },
  { id: "e4", job_id: "j2", book_id: "b1", kind: "progress", progress: 60, message: "Assembling chapter 1 — 16/27 sections", created_at: "2026-02-17T08:15:00Z" },
];
