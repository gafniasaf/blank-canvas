import { supabaseRest } from "../http.js";

export async function bookStatusHandler(params: Record<string, unknown>) {
  const { book_id } = params;
  if (!book_id) throw new Error("book_id is required");
  const book = await supabaseRest("book_registry", { query: `book_id=eq.${book_id}&select=*` });
  const jobs = await supabaseRest("pipeline_jobs", { query: `book_id=eq.${book_id}&select=*&order=priority.desc,created_at.asc` });
  const counts: Record<string, number> = {};
  if (Array.isArray(jobs)) { for (const j of jobs) { counts[j.status] = (counts[j.status] || 0) + 1; } }
  return { book: Array.isArray(book) ? book[0] : book, jobs, statusCounts: counts };
}

