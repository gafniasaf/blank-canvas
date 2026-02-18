/**
 * Job event emission — progress tracking + heartbeat.
 * Events are stored in pipeline_events and power realtime dashboard subscriptions.
 */

import { adminSupabase } from "./supabase.js";

export async function emitJobEvent(
  jobId: string,
  bookId: string,
  eventType: string,
  progress: number | null,
  message: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { error } = await adminSupabase().rpc("emit_pipeline_event", {
      p_job_id: jobId,
      p_book_id: bookId,
      p_event_type: eventType,
      p_progress: progress,
      p_message: message,
      p_metadata: metadata,
    });
    if (error) {
      console.warn(`[event] Failed to emit event for job ${jobId}: ${error.message}`);
    }
  } catch (e) {
    // Best-effort — don't let event emission crash the worker
    console.warn(`[event] Exception emitting event for job ${jobId}:`, e);
  }
}

export async function updateJobHeartbeat(jobId: string): Promise<void> {
  try {
    await adminSupabase()
      .from("pipeline_jobs")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", jobId);
  } catch {
    // best-effort
  }
}

