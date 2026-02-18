/**
 * CLI: Monitor pipeline progress in real-time.
 *
 * Subscribes to Supabase Realtime on pipeline_events and pipeline_jobs
 * to show live progress updates.
 *
 * Usage:
 *   npx tsx cli/monitor.ts [--book-id <ID>]
 */

import { adminSupabase } from "../src/supabase.js";
import "../src/env.js";

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function main() {
  const bookId = getArg("--book-id");

  console.log(`[monitor] Subscribing to pipeline events${bookId ? ` for book ${bookId}` : " (all books)"}...`);
  console.log("[monitor] Press Ctrl+C to stop.\n");

  // Subscribe to pipeline_events
  const channel = adminSupabase()
    .channel("pipeline-monitor")
    .on(
      "postgres_changes" as "system",
      {
        event: "INSERT",
        schema: "public",
        table: "pipeline_events",
        ...(bookId ? { filter: `book_id=eq.${bookId}` } : {}),
      } as Record<string, string>,
      (payload: { new: Record<string, unknown> }) => {
        const e = payload.new;
        const progress = e.progress != null ? `${e.progress}%` : "";
        const msg = e.message || "";
        const type = e.event_type || "";
        const time = formatTime(e.created_at as string);

        console.log(
          `[${time}] ${String(e.book_id).padEnd(30)} | ${String(type).padEnd(10)} | ${progress.padStart(4)} | ${msg}`
        );
      }
    )
    .subscribe();

  // Also subscribe to job status changes
  adminSupabase()
    .channel("pipeline-jobs-monitor")
    .on(
      "postgres_changes" as "system",
      {
        event: "UPDATE",
        schema: "public",
        table: "pipeline_jobs",
        ...(bookId ? { filter: `book_id=eq.${bookId}` } : {}),
      } as Record<string, string>,
      (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => {
        const j = payload.new;
        const oldStatus = payload.old?.status;
        const newStatus = j.status;
        if (oldStatus === newStatus) return;

        const icon = newStatus === "done" ? "✅" : newStatus === "failed" ? "❌" : newStatus === "running" ? "🔄" : "⏳";
        console.log(
          `${icon} Job ${String(j.step).padEnd(25)} ch${String(j.chapter ?? "all").padEnd(4)} | ${oldStatus} → ${newStatus}${j.error ? ` | ${j.error}` : ""}`
        );
      }
    )
    .subscribe();

  // Keep process alive
  await new Promise(() => {});
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

