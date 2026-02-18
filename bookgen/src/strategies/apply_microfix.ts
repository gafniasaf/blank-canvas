/**
 * apply_microfix strategy
 *
 * Strips leading <<MICRO_TITLE>>...<<MICRO_TITLE_END>> markers that appear
 * immediately after a section/subparagraph heading (redundant; heading already serves as title).
 *
 * Ported from TestRun: new_pipeline/fix/remove-leading-microtitles-under-headings.ts
 *
 * Input:  canonical chapter JSON
 * Output: cleaned canonical chapter JSON (in-place update)
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import type { CanonicalBook, ContentBlock, ParagraphBlock } from "../schema/canonical.js";

const MICRO_RE = /^<<MICRO_TITLE>>[\s\S]*?<<MICRO_TITLE_END>>\s*/;

function stripLeadingMicroTitle(text: string): { text: string; stripped: boolean } {
  const match = text.match(MICRO_RE);
  if (!match) return { text, stripped: false };
  return { text: text.replace(MICRO_RE, "").trim(), stripped: true };
}

export default class ApplyMicrofix implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;

    const canonicalPath = job.input_artifacts.canonical_json;
    if (!canonicalPath) throw new Error("BLOCKED: input_artifacts.canonical_json is required");

    await emitJobEvent(job.id, job.book_id, "progress", 10, "Loading canonical");
    const canonical = await downloadJson<CanonicalBook>(canonicalPath);

    let stripped = 0;

    function processBlocks(blocks: ContentBlock[], isFirstUnderHeading: boolean): void {
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i]!;
        const isFirst = i === 0 && isFirstUnderHeading;

        if (block.type === "paragraph" && isFirst) {
          const p = block as ParagraphBlock;
          const result = stripLeadingMicroTitle(p.basis);
          if (result.stripped) {
            p.basis = result.text;
            stripped++;
          }
        } else if (block.type === "subparagraph") {
          processBlocks(block.content, true);
        }
      }
    }

    for (const ch of canonical.chapters) {
      for (const sec of ch.sections) {
        processBlocks(sec.content, true);
      }
    }

    if (stripped > 0) {
      await emitJobEvent(job.id, job.book_id, "progress", 80, `Stripped ${stripped} leading microtitles`);
      await uploadJson(canonicalPath, canonical);
    }

    return { ok: true, outPath: canonicalPath, stripped };
  }
}

