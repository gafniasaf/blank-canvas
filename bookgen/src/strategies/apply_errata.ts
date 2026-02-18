/**
 * apply_errata strategy
 *
 * Applies factual errata overrides to a canonical chapter JSON.
 * Ported from TestRun: new_pipeline/fix/apply-factual-errata-overrides.ts
 *
 * Input:  canonical chapter JSON + errata pack JSON
 * Output: corrected canonical chapter JSON
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import type { CanonicalBook, ParagraphBlock } from "../schema/canonical.js";

interface ErrataEntry {
  paragraph_id: string;
  field: "basis" | "praktijk" | "verdieping";
  find: string;
  replace: string;
  reason?: string;
}

interface ErrataPack {
  entries: ErrataEntry[];
}

export default class ApplyErrata implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;

    const canonicalPath = job.input_artifacts.canonical_json;
    if (!canonicalPath) throw new Error("BLOCKED: input_artifacts.canonical_json is required");

    const errataPath = job.input_artifacts.errata_json;

    // If no errata pack, pass through
    if (!errataPath) {
      await emitJobEvent(job.id, job.book_id, "progress", 100, "No errata pack; skipping");
      return { ok: true, outPath: canonicalPath, applied: 0, skipped: true };
    }

    await emitJobEvent(job.id, job.book_id, "progress", 10, "Loading canonical + errata");
    const canonical = await downloadJson<CanonicalBook>(canonicalPath);
    const errata = await downloadJson<ErrataPack>(errataPath);

    if (!errata.entries?.length) {
      return { ok: true, outPath: canonicalPath, applied: 0 };
    }

    let applied = 0;
    const entryMap = new Map<string, ErrataEntry[]>();
    for (const e of errata.entries) {
      const list = entryMap.get(e.paragraph_id) ?? [];
      list.push(e);
      entryMap.set(e.paragraph_id, list);
    }

    for (const ch of canonical.chapters) {
      for (const sec of ch.sections) {
        const walk = (blocks: typeof sec.content) => {
          for (const block of blocks) {
            if (block.type === "paragraph") {
              const p = block as ParagraphBlock;
              const fixes = entryMap.get(p.id);
              if (fixes) {
                for (const fix of fixes) {
                  const field = fix.field as keyof Pick<ParagraphBlock, "basis" | "praktijk" | "verdieping">;
                  const current = p[field];
                  if (typeof current === "string" && current.includes(fix.find)) {
                    (p as unknown as Record<string, unknown>)[field] = current.replace(fix.find, fix.replace);
                    applied++;
                  }
                }
              }
            } else if (block.type === "subparagraph") {
              walk(block.content);
            }
          }
        };
        walk(sec.content);
      }
    }

    await emitJobEvent(job.id, job.book_id, "progress", 80, `Applied ${applied} errata fixes`);

    // Write back to same path (in-place update)
    await uploadJson(canonicalPath, canonical);

    return { ok: true, outPath: canonicalPath, applied };
  }
}

