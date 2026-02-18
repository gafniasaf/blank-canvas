// ------------------------------------------------------------------
// AUTO-GENERATED FROM system-manifest.json
// ------------------------------------------------------------------
// Run: npx ignite scaffold
// DO NOT EDIT MANUALLY — changes will be overwritten.
// ------------------------------------------------------------------
import { z } from 'zod';

export const BookRegistrySchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  book_id: z.string().optional(),
  title: z.string().optional(),
  isbn: z.string().optional(),
  level: z.enum(['n3', 'n4']).optional(),
  language: z.string().optional(),
  chapters: z.any().optional(),
  canonical_idml: z.string().optional(),
  template_profile: z.any().optional(),
  upload_id: z.string().optional(),
  status: z.enum(['draft', 'ingesting', 'generating', 'complete', 'failed']).optional(),
  config: z.any().optional()
});
export type BookRegistry = z.infer<typeof BookRegistrySchema>;


export const PipelineJobSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  book_id: z.string().optional(),
  chapter: z.number().optional(),
  section: z.string().optional(),
  step: z.enum(['ingest_book', 'extract_tokens', 'export_canonical', 'extract_skeleton', 'generate_section', 'assemble_chapter', 'generate_figures', 'generate_ai_images', 'inject_existing_figures', 'generate_chapter_recap', 'apply_boxes', 'apply_errata', 'apply_microfix', 'render_chapter_pdf', 'assemble_book', 'generate_index', 'generate_glossary', 'normalize_voice', 'render_book_pdf', 'validate_book']).optional(),
  status: z.enum(['pending', 'claimed', 'running', 'done', 'failed', 'cancelled']).optional(),
  worker_id: z.string().optional(),
  priority: z.number().optional(),
  depends_on: z.any().optional(),
  input_artifacts: z.any().optional(),
  output_artifacts: z.any().optional(),
  error: z.string().optional(),
  attempts: z.number().optional(),
  max_attempts: z.number().optional(),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional()
});
export type PipelineJob = z.infer<typeof PipelineJobSchema>;


export const PipelineEventSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  job_id: z.string().optional(),
  book_id: z.string().optional(),
  event_type: z.string().optional(),
  progress: z.number().optional(),
  message: z.string().optional(),
  metadata: z.any().optional()
});
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;

export const JOB_MODES = {
  "ingest_book": "async",
  "extract_tokens": "async",
  "export_canonical": "async",
  "extract_skeleton": "async",
  "generate_section": "async",
  "assemble_chapter": "async",
  "generate_figures": "async",
  "generate_ai_images": "async",
  "inject_existing_figures": "async",
  "generate_chapter_recap": "async",
  "apply_boxes": "async",
  "apply_errata": "async",
  "apply_microfix": "async",
  "render_chapter_pdf": "async",
  "assemble_book": "async",
  "generate_index": "async",
  "generate_glossary": "async",
  "normalize_voice": "async",
  "render_book_pdf": "async",
  "validate_book": "async"
} as const;

export type JobType = keyof typeof JOB_MODES;

export const PIPELINE_STEPS = [
  "ingest_book",
  "extract_tokens",
  "export_canonical",
  "extract_skeleton",
  "generate_section",
  "assemble_chapter",
  "generate_figures",
  "inject_existing_figures",
  "generate_chapter_recap",
  "apply_boxes",
  "apply_errata",
  "apply_microfix",
  "render_chapter_pdf",
  "assemble_book",
  "generate_index",
  "generate_glossary",
  "normalize_voice",
  "render_book_pdf",
  "validate_book"
] as const;

export type PipelineStep = typeof PIPELINE_STEPS[number];
