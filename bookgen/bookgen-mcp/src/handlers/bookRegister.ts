import { supabaseRest } from "../http.js";

export async function bookRegisterHandler(params: Record<string, unknown>) {
  const { book_id, title, level, chapters } = params;
  if (!book_id || !title || !level) throw new Error("book_id, title, and level are required");
  return supabaseRest("book_registry", {
    method: "POST",
    body: { book_id, title, level, chapters: chapters ?? [], status: "draft" },
    headers: { Prefer: "return=representation" },
  });
}

