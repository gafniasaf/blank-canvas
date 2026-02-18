/**
 * Shared types for all pipeline strategies.
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
  | "inject_existing_figures"
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

export interface JobContext {
  job: PipelineJob;
  workerId: string;
}

/**
 * Return value from a strategy's execute():
 * - A plain result object = job is done.
 * - A YieldResult = job should be re-queued with updated payload (for multi-step strategies).
 */
export interface YieldResult {
  yield: true;
  message?: string;
  nextInputArtifacts?: Record<string, string>;
  progress?: number;
  meta?: Record<string, unknown>;
}

export type StrategyResult = Record<string, unknown> | YieldResult;

export interface JobExecutor {
  execute(ctx: JobContext): Promise<StrategyResult>;
}

export function isYieldResult(v: unknown): v is YieldResult {
  return !!v && typeof v === "object" && (v as YieldResult).yield === true;
}

