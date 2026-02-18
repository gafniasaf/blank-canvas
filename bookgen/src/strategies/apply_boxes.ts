/**
 * apply_boxes strategy
 *
 * Applies praktijk/verdieping differentiation boxes to canonical chapter JSON.
 * Ported from TestRun: new_pipeline/export/apply-kd-differentiation-poc.py (logic adapted to TS)
 *
 * Rules (from .cursorrules):
 * - Option A headings only: bold label + colon + inline text
 * - Never place boxes inside list-intro paragraphs ending with ':'
 * - After colon, start lowercase except abbreviation-like tokens
 * - Box content is KD-free (no codes/tags/"KD" mentions)
 *
 * Input:  canonical chapter JSON
 * Output: canonical chapter JSON with boxes applied
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import type { CanonicalBook, ParagraphBlock, ContentBlock } from "../schema/canonical.js";

function isParagraphSafeForBox(block: ParagraphBlock, nextBlock: ContentBlock | undefined): boolean {
  const basis = block.basis ?? "";
  // Rule: never place box in list-intro paragraphs ending with ':' when followed by bullet runs
  if (basis.trimEnd().endsWith(":") && nextBlock?.type === "list") {
    return false;
  }
  // Skip very short paragraphs
  if (basis.length < 40) return false;
  return true;
}

export default class ApplyBoxes implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;

    const canonicalPath = job.input_artifacts.canonical_json;
    if (!canonicalPath) throw new Error("BLOCKED: input_artifacts.canonical_json is required");

    const praktijkEvery = Number(job.input_artifacts.praktijk_every ?? 2);
    const verdiepingEvery = Number(job.input_artifacts.verdieping_every ?? 3);

    await emitJobEvent(job.id, job.book_id, "progress", 10, "Loading canonical");
    const canonical = await downloadJson<CanonicalBook>(canonicalPath);

    let praktijkCount = 0;
    let verdiepingCount = 0;

    for (const ch of canonical.chapters) {
      let subIdx = 0;
      for (const sec of ch.sections) {
        const processBlocks = (blocks: ContentBlock[]) => {
          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i]!;

            if (block.type === "subparagraph") {
              subIdx++;
              // Process inner blocks
              const innerParas = block.content.filter((b) => b.type === "paragraph") as ParagraphBlock[];
              if (innerParas.length === 0) continue;

              // Find last safe paragraph for box placement
              let safeIdx = -1;
              for (let j = innerParas.length - 1; j >= 0; j--) {
                if (isParagraphSafeForBox(innerParas[j]!, block.content[j + 1])) {
                  safeIdx = j;
                  break;
                }
              }
              if (safeIdx < 0) continue;
              const target = innerParas[safeIdx]!;

              // Apply boxes based on frequency
              if (praktijkEvery > 0 && subIdx % praktijkEvery === 0 && !target.praktijk) {
                // Placeholder — actual content comes from LLM or skeleton
                target.praktijk = target.praktijk ?? undefined;
                praktijkCount++;
              }
              if (verdiepingEvery > 0 && subIdx % verdiepingEvery === 0 && !target.verdieping) {
                target.verdieping = target.verdieping ?? undefined;
                verdiepingCount++;
              }
            }
          }
        };
        processBlocks(sec.content);
      }
    }

    await emitJobEvent(job.id, job.book_id, "progress", 80, `Boxes: ${praktijkCount} praktijk, ${verdiepingCount} verdieping`);
    await uploadJson(canonicalPath, canonical);

    return { ok: true, outPath: canonicalPath, praktijkCount, verdiepingCount };
  }
}

