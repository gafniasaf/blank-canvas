/**
 * Frontend types mirroring the pipeline schema.
 * These are duplicated from src/strategies/types.ts to avoid
 * importing backend-only code into the frontend bundle.
 */

export type PipelineStep =
  | "ingest_book"
  | "extract_tokens"
  | "export_canonical"
  | "extract_skeleton"
  | "generate_section"
  | "assemble_chapter"
  | "generate_figures"
  | "generate_ai_images"
  | "generate_chapter_recap"
  | "apply_boxes"
  | "apply_errata"
  | "apply_microfix"
  | "render_chapter_pdf"
  | "assemble_book"
  | "generate_index"
  | "generate_glossary"
  | "normalize_voice"
  | "render_book_pdf"
  | "validate_book";

export type JobStatus = "pending" | "claimed" | "running" | "done" | "failed" | "cancelled";

export type BookStatus = "draft" | "ingesting" | "generating" | "complete" | "failed";

export interface Book {
  book_id: string;
  title: string;
  isbn: string | null;
  level: "n3" | "n4";
  language: string;
  chapters: number[];
  status: BookStatus;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PipelineJob {
  id: string;
  book_id: string;
  chapter: number | null;
  section: string | null;
  step: PipelineStep;
  status: JobStatus;
  worker_id: string | null;
  priority: number;
  depends_on: string[] | null;
  input_artifacts: Record<string, string>;
  output_artifacts: Record<string, string>;
  error: string | null;
  attempts: number;
  max_attempts: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineEvent {
  id: number;
  job_id: string;
  book_id: string;
  event_type: "progress" | "heartbeat" | "log" | "error" | "done";
  progress: number | null;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const STEP_LABELS: Record<PipelineStep, string> = {
  ingest_book: "Ingest Book",
  extract_tokens: "Extract Tokens",
  export_canonical: "Export Canonical",
  extract_skeleton: "Extract Skeleton",
  generate_section: "Generate Section",
  assemble_chapter: "Assemble Chapter",
  generate_figures: "Generate Figures",
  generate_ai_images: "AI Image Generation",
  generate_chapter_recap: "Chapter Recap",
  apply_boxes: "Apply Boxes",
  apply_errata: "Apply Errata",
  apply_microfix: "Apply Microfix",
  render_chapter_pdf: "Render PDF",
  assemble_book: "Assemble Book",
  generate_index: "Generate Index",
  generate_glossary: "Generate Glossary",
  normalize_voice: "Normalize Voice",
  render_book_pdf: "Render Book PDF",
  validate_book: "Validate Book",
};
