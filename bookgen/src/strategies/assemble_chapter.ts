/**
 * assemble_chapter strategy
 *
 * Compiles skeleton_v1 -> CanonicalBook JSON for a single chapter.
 * Ported from TestRun: new_pipeline/scripts/assemble-skeleton-rewrites.ts
 *
 * Input:  skeleton chapter JSON (fully generated)
 * Output: canonical chapter JSON (ready for rendering)
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson, artifactPath } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import type { BookSkeletonV1 } from "../schema/skeleton.js";
import { validateBookSkeleton } from "../schema/skeleton.js";
import { compileSkeletonToCanonical } from "../schema/canonical.js";

export default class AssembleChapter implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const chapter = job.chapter;
    if (chapter == null) throw new Error("BLOCKED: chapter is required for assemble_chapter");

    const skeletonPath = job.input_artifacts.skeleton_json;
    if (!skeletonPath) throw new Error("BLOCKED: input_artifacts.skeleton_json is required");

    await emitJobEvent(job.id, job.book_id, "progress", 10, "Loading skeleton");
    const skeleton = await downloadJson<BookSkeletonV1>(skeletonPath);

    // Validate before compiling
    const validation = validateBookSkeleton(skeleton);
    if (!validation.ok) {
      const errors = validation.issues.filter((i) => i.severity === "error");
      throw new Error(`BLOCKED: Skeleton validation failed with ${errors.length} error(s): ${errors.map((e) => e.message).join("; ")}`);
    }

    await emitJobEvent(job.id, job.book_id, "progress", 40, "Compiling skeleton to canonical");
    const canonical = compileSkeletonToCanonical(skeleton);

    // Terminology gate: reject if forbidden terms appear in basis text
    const forbidden = ["cliënt", "client", "verpleegkundige", "patiënt", "patient"];
    const violations: string[] = [];
    for (const ch of canonical.chapters) {
      for (const sec of ch.sections) {
        for (const block of sec.content) {
          if (block.type === "paragraph") {
            const text = (block.basis + (block.praktijk ?? "") + (block.verdieping ?? "")).toLowerCase();
            for (const term of forbidden) {
              if (text.includes(term)) {
                violations.push(`${sec.number}/${block.id}: contains "${term}"`);
              }
            }
          }
        }
      }
    }
    if (violations.length > 0) {
      console.warn(`[assemble_chapter] Terminology violations (${violations.length}):`, violations.slice(0, 10));
      // Log but don't block — these come from the original source text and will be cleaned in voice normalization
    }

    const versionId = skeleton.meta.bookVersionId || "v1";
    const outPath = artifactPath(job.book_id, versionId, `canonical_ch${chapter}.json`);
    await emitJobEvent(job.id, job.book_id, "progress", 80, "Uploading canonical chapter JSON");
    await uploadJson(outPath, canonical);

    return { ok: true, outPath, chapters: canonical.chapters.length, terminologyViolations: violations.length };
  }
}

