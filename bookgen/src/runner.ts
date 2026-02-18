/**
 * BookGen Worker Runner
 *
 * Polls Supabase for pending pipeline_jobs, claims one at a time,
 * executes the matching strategy, and marks it done/failed.
 *
 * Based on LearnPlay's queue-pump/src/runner.ts pattern.
 */

import { adminSupabase } from "./supabase.js";
import { optionalEnv, parseIntEnv, requireEnv, sleep } from "./env.js";
import { emitJobEvent, updateJobHeartbeat } from "./job-events.js";
import { JobRegistry } from "./registry.js";
import type { PipelineJob, YieldResult } from "./strategies/types.js";
import { isYieldResult } from "./strategies/types.js";

const IDLE_SLEEP_MS = parseIntEnv("BOOKGEN_IDLE_SLEEP_MS", 5000);
const LOG_EVERY = parseIntEnv("BOOKGEN_LOG_EVERY", 1);
const MAX_YIELDS = parseIntEnv("BOOKGEN_MAX_YIELDS", 1500);

function nowIso(): string {
  return new Date().toISOString();
}

async function claimNextJob(workerId: string): Promise<PipelineJob | null> {
  const { data, error } = await adminSupabase().rpc("claim_next_pipeline_job", {
    p_worker_id: workerId,
  });
  if (error) throw new Error(`claim_next_pipeline_job failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data && typeof data === "object" ? data : null;
  if (!row || !(row as PipelineJob).id) return null;
  return row as PipelineJob;
}

async function markJobRunning(jobId: string): Promise<void> {
  await adminSupabase()
    .from("pipeline_jobs")
    .update({ status: "running", updated_at: nowIso() })
    .eq("id", jobId);
}

async function markJobDone(
  jobId: string,
  outputArtifacts: Record<string, string>
): Promise<void> {
  await adminSupabase()
    .from("pipeline_jobs")
    .update({
      status: "done",
      output_artifacts: outputArtifacts,
      completed_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq("id", jobId);
}

async function markJobFailed(jobId: string, error: string): Promise<void> {
  await adminSupabase()
    .from("pipeline_jobs")
    .update({
      status: "failed",
      error: error.slice(0, 4000),
      completed_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq("id", jobId);
}

async function requeueJobWithYield(
  jobId: string,
  yieldResult: YieldResult
): Promise<void> {
  const updates: Record<string, unknown> = {
    status: "pending",
    worker_id: null,
    started_at: null,
    updated_at: nowIso(),
  };
  if (yieldResult.nextInputArtifacts) {
    updates.input_artifacts = yieldResult.nextInputArtifacts;
  }
  await adminSupabase().from("pipeline_jobs").update(updates).eq("id", jobId);
}

async function runOnce(workerId: string, registry: JobRegistry): Promise<boolean> {
  const job = await claimNextJob(workerId);
  if (!job) return false;

  console.log(
    `[worker] Claimed job ${job.id} (step=${job.step}, book=${job.book_id}, ch=${job.chapter ?? "all"}, attempt=${job.attempts})`
  );

  // Mark as running
  await markJobRunning(job.id);
  await emitJobEvent(job.id, job.book_id, "progress", 0, `Starting ${job.step}`);

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => updateJobHeartbeat(job.id), 30_000);

  try {
    const executor = await registry.get(job.step);
    if (!executor) {
      throw new Error(`No strategy registered for step: ${job.step}`);
    }

    let result = await executor.execute({ job, workerId });

    // Handle yield-based multi-step strategies
    let yieldCount = 0;
    while (isYieldResult(result) && yieldCount < MAX_YIELDS) {
      yieldCount++;
      const yr = result;
      console.log(`[worker] Job ${job.id} yielded (${yieldCount}): ${yr.message ?? ""}`);

      if (yr.progress != null) {
        await emitJobEvent(job.id, job.book_id, "progress", yr.progress, yr.message ?? "");
      }

      await requeueJobWithYield(job.id, yr);

      // Re-claim immediately (same worker, no sleep)
      const reclaimed = await claimNextJob(workerId);
      if (!reclaimed || reclaimed.id !== job.id) {
        // Another worker took it, or it wasn't re-queued; stop.
        console.log(`[worker] Yield re-claim missed for job ${job.id}; moving on.`);
        clearInterval(heartbeatInterval);
        return true;
      }
      await markJobRunning(reclaimed.id);
      const reExecutor = await registry.get(reclaimed.step);
      if (!reExecutor) throw new Error(`No strategy for step: ${reclaimed.step}`);
      result = await reExecutor.execute({ job: reclaimed, workerId });
    }

    if (isYieldResult(result)) {
      throw new Error(`Job ${job.id} exceeded MAX_YIELDS (${MAX_YIELDS})`);
    }

    // Extract output artifacts from result
    const outputArtifacts: Record<string, string> = {};
    if (result && typeof result === "object") {
      for (const [k, v] of Object.entries(result)) {
        if (typeof v === "string" && (k.endsWith("Path") || k.endsWith("_path") || k === "outPath")) {
          outputArtifacts[k] = v;
        }
      }
    }

    await markJobDone(job.id, outputArtifacts);
    await emitJobEvent(job.id, job.book_id, "done", 100, `Completed ${job.step}`, result as Record<string, unknown>);
    console.log(`[worker] Job ${job.id} done.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Job ${job.id} failed: ${msg}`);
    await markJobFailed(job.id, msg);
    await emitJobEvent(job.id, job.book_id, "error", null, msg);
  } finally {
    clearInterval(heartbeatInterval);
  }

  return true;
}

async function main(): Promise<void> {
  const workerId = optionalEnv("WORKER_ID", process.env.FLY_MACHINE_ID ?? `local-${process.pid}`);
  console.log(`[bookgen-worker] Starting (worker=${workerId}, idle_sleep=${IDLE_SLEEP_MS}ms)`);

  // Verify DB connectivity
  const { error } = await adminSupabase().from("book_registry").select("book_id").limit(1);
  if (error) {
    console.error(`[bookgen-worker] DB connectivity check failed: ${error.message}`);
    process.exit(1);
  }
  console.log("[bookgen-worker] DB connectivity OK.");

  const registry = new JobRegistry();
  let pollCount = 0;

  // Main loop
  while (true) {
    try {
      const didWork = await runOnce(workerId, registry);
      if (!didWork) {
        pollCount++;
        if (pollCount % LOG_EVERY === 0) {
          console.log(`[bookgen-worker] Idle (poll #${pollCount})...`);
        }
        await sleep(IDLE_SLEEP_MS);
      } else {
        pollCount = 0;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bookgen-worker] Loop error: ${msg}`);
      await sleep(IDLE_SLEEP_MS * 2);
    }
  }
}

main().catch((e) => {
  console.error("[bookgen-worker] Fatal:", e);
  process.exit(1);
});

