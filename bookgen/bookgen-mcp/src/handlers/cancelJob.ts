import { supabaseRest } from "../http.js";

export async function cancelJobHandler(params: Record<string, unknown>) {
  const { id } = params;
  if (!id) throw new Error("id is required");
  await supabaseRest("pipeline_jobs", {
    method: "PATCH",
    query: `id=eq.${id}`,
    body: { status: "cancelled", completed_at: new Date().toISOString() },
  });
  return { ok: true, cancelled: id };
}

