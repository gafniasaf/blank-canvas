import { supabaseRest } from "../http.js";

export async function getJobHandler(params: Record<string, unknown>) {
  const { id } = params;
  if (!id) throw new Error("id is required");
  const jobs = await supabaseRest("pipeline_jobs", { query: `id=eq.${id}&select=*` });
  const events = await supabaseRest("pipeline_events", { query: `job_id=eq.${id}&select=*&order=created_at.desc&limit=20` });
  return { job: Array.isArray(jobs) ? jobs[0] : jobs, events };
}

