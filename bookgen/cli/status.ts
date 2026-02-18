/**
 * CLI: Show pipeline status for a book.
 *
 * Usage:
 *   npx tsx cli/status.ts [--book-id <ID>]
 *   npx tsx cli/status.ts --all
 */

import { adminSupabase } from "../src/supabase.js";
import "../src/env.js";

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function showBookStatus(bookId: string) {
  const { data: jobs, error } = await adminSupabase()
    .from("pipeline_jobs")
    .select("*")
    .eq("book_id", bookId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`Failed to load jobs for ${bookId}:`, error.message);
    return;
  }

  if (!jobs?.length) {
    console.log(`No pipeline jobs found for book ${bookId}.`);
    return;
  }

  const statusCounts: Record<string, number> = {};
  for (const j of jobs) {
    statusCounts[j.status] = (statusCounts[j.status] || 0) + 1;
  }

  console.log(`\n📚 Book: ${bookId}`);
  console.log(`   Total jobs: ${jobs.length}`);
  console.log(`   Status: ${Object.entries(statusCounts).map(([s, c]) => `${s}=${c}`).join(", ")}`);
  console.log("");

  // Group by step
  const byStep = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const list = byStep.get(j.step) ?? [];
    list.push(j);
    byStep.set(j.step, list);
  }

  for (const [step, stepJobs] of byStep) {
    const statusIcons: Record<string, string> = {
      pending: "⏳",
      claimed: "🔒",
      running: "🔄",
      done: "✅",
      failed: "❌",
      cancelled: "🚫",
    };

    const summary = stepJobs.map((j) => {
      const icon = statusIcons[j.status] || "?";
      const ch = j.chapter != null ? `ch${j.chapter}` : "book";
      return `${icon}${ch}`;
    }).join(" ");

    console.log(`   ${step.padEnd(25)} ${summary}`);
  }
}

async function showAllBooks() {
  const { data: books, error } = await adminSupabase()
    .from("book_registry")
    .select("book_id, title, status, chapters")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load books:", error.message);
    return;
  }

  if (!books?.length) {
    console.log("No books registered.");
    return;
  }

  console.log(`\n📚 Registered Books (${books.length}):`);
  for (const b of books) {
    const chCount = Array.isArray(b.chapters) ? b.chapters.length : 0;
    console.log(`   ${b.book_id.padEnd(45)} | ${b.status.padEnd(12)} | ${chCount} chapters | ${b.title}`);
  }
}

async function main() {
  const bookId = getArg("--book-id");
  const showAll = hasFlag("--all");

  if (showAll || (!bookId && !showAll)) {
    await showAllBooks();
  }

  if (bookId) {
    await showBookStatus(bookId);
  }

  console.log("");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

