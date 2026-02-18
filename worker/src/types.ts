/**
 * Ignite Worker Types
 * Defines the contract between Control Plane (Supabase) and Execution Plane (Worker).
 */

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type JobType = 'build_chapter' | 'build_book' | 'validate_json';

export interface JobInputs {
  /** The UUID of the uploaded book/version in public.book_uploads */
  upload_id: string;
  
  /** Chapter number to build (1-based) */
  chapter: number;
  
  /** Optional: URL/path to specific figures mapping JSON */
  figures_map_url?: string;
  
  /** Optional: Force full rebuild (ignore cache) */
  force?: boolean;
}

export interface JobOutputs {
  /** URL to the final generated PDF */
  pdf_url?: string;
  
  /** URL to the assembled canonical JSON */
  json_url?: string;
  
  /** Page count of the generated PDF */
  page_count?: number;
  
  /** Summary of validation warnings (if any) */
  validation_summary?: {
    page_fill_warnings: number;
    layout_gaps: number;
  };
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  inputs: JobInputs;
  outputs?: JobOutputs;
  worker_id?: string;
  created_at: string;
}

export interface Artifact {
  job_id: string;
  upload_id: string;
  chapter_number: number;
  type: 'pdf' | 'html' | 'json_canonical' | 'json_rewrites' | 'report_layout' | 'log_prince';
  storage_path: string;
  file_size_bytes: number;
}

export interface WorkerConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  workerId: string;
  pollIntervalMs: number;
}











