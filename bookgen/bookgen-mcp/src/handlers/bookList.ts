import { supabaseRest } from "../http.js";

export async function bookListHandler(_params: Record<string, unknown>) {
  return supabaseRest("book_registry", { query: "select=*&order=created_at.desc" });
}

