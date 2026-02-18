/**
 * assemble_book strategy
 *
 * Merges all chapter canonical JSONs into a single book canonical JSON.
 *
 * Input:  individual chapter canonical JSONs from Storage
 * Output: merged canonical_book.json
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson, artifactPath } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import { adminSupabase } from "../supabase.js";
import type { CanonicalBook } from "../schema/canonical.js";

export default class AssembleBook implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const versionId = job.input_artifacts.book_version_id || "v1";

    await emitJobEvent(job.id, job.book_id, "progress", 5, "Loading book registry");

    // Get chapters list from book_registry
    const { data: book } = await adminSupabase()
      .from("book_registry")
      .select("chapters, title")
      .eq("book_id", job.book_id)
      .single();

    const chapters: number[] = book?.chapters ?? [];
    if (chapters.length === 0) throw new Error("BLOCKED: No chapters found in book_registry");

    await emitJobEvent(job.id, job.book_id, "progress", 10, `Merging ${chapters.length} chapters`);

    // Load each chapter canonical
    const merged: CanonicalBook = {
      meta: { id: job.book_id, title: book?.title ?? job.book_id, level: "n3" },
      chapters: [],
      export: { exportedAt: new Date().toISOString(), source: "bookgen", schemaVersion: "1.0" },
    };

    for (const ch of chapters) {
      const chPath = artifactPath(job.book_id, versionId, `canonical_ch${ch}.json`);
      try {
        const chCanonical = await downloadJson<CanonicalBook>(chPath);
        if (chCanonical.chapters?.length) {
          merged.chapters.push(...chCanonical.chapters);
        }
        if (chCanonical.meta?.level) merged.meta.level = chCanonical.meta.level;
      } catch (e) {
        console.warn(`[assemble_book] Could not load ch${ch}: ${e instanceof Error ? e.message : e}`);
        // Continue with remaining chapters
      }
    }

    if (merged.chapters.length === 0) {
      throw new Error("BLOCKED: No chapters could be loaded");
    }

    const outPath = artifactPath(job.book_id, versionId, "canonical_book.json");
    await emitJobEvent(job.id, job.book_id, "progress", 80, `Saving merged book (${merged.chapters.length} chapters)`);
    await uploadJson(outPath, merged);

    return { ok: true, outPath, chapters: merged.chapters.length };
  }
}

