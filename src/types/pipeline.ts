export interface Book {
  book_id: string;
  title: string;
  level: string;
  status: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface PipelineJob {
  id: string;
  book_id: string;
  step: string;
  chapter?: number | null;
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  error?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface PipelineEvent {
  id: string;
  job_id: string;
  book_id: string;
  kind: "progress" | "done" | "error";
  progress: number | null;
  message: string;
  created_at: string;
}
