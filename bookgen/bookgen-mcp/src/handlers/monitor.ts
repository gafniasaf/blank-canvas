import { supabaseRest } from "../http.js";

export async function monitorHandler(params: Record<string, unknown>) {
  const limit = params.limit ?? 50;
  const query = params.book_id
    ? `book_id=eq.${params.book_id}&select=*&order=created_at.desc&limit=${limit}`
    : `select=*&order=created_at.desc&limit=${limit}`;
  return supabaseRest("pipeline_events", { query });
}

