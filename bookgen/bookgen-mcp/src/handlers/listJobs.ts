import { supabaseRest } from "../http.js";

export async function listJobsHandler(params: Record<string, unknown>) {
  const parts: string[] = ["select=*", "order=created_at.desc", `limit=${params.limit ?? 50}`];
  if (params.book_id) parts.push(`book_id=eq.${params.book_id}`);
  if (params.status) parts.push(`status=eq.${params.status}`);
  if (params.step) parts.push(`step=eq.${params.step}`);
  return supabaseRest("pipeline_jobs", { query: parts.join("&") });
}

