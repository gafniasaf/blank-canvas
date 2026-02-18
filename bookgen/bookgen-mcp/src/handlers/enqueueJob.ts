import { supabaseRest } from "../http.js";

export async function enqueueJobHandler(params: Record<string, unknown>) {
  const { book_id, chapter, section, step, priority, depends_on, input_artifacts } = params;
  if (!book_id || !step) throw new Error("book_id and step are required");

  const result = await supabaseRest("pipeline_jobs", {
    method: "POST",
    body: {
      book_id, chapter: chapter ?? null, section: section ?? null,
      step, status: "pending", priority: priority ?? 0,
      depends_on: depends_on ?? [], input_artifacts: input_artifacts ?? {},
    },
    headers: { Prefer: "return=representation" },
  });
  return result;
}

