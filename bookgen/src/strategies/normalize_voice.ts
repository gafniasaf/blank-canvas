/**
 * normalize_voice strategy
 *
 * Post-pass rewrite to normalize the writing voice across a book chapter.
 * Ported from LearnPlay: supabase/functions/ai-job-runner/strategies/book_normalize_voice.ts
 *
 * Uses yield-based batching: rewrites 8 text blocks per yield, saves skeleton
 * at section boundaries, then re-queues itself for the next batch.
 *
 * Goal: make all chapters match an N3-style voice (student-friendly Dutch)
 * while preserving structure, IDs, and inline HTML constraints.
 *
 * Input:  skeleton chapter JSON
 * Output: skeleton with voice-normalized text (in-place updates)
 */

import type { JobContext, JobExecutor, StrategyResult, YieldResult } from "./types.js";
import { downloadJson, uploadJson } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import { llmChatComplete, parseModelSpec, withRetries } from "../llm.js";
import type { BookSkeletonV1 } from "../schema/skeleton.js";
import { validateBookSkeleton } from "../schema/skeleton.js";

type RewriteItem = { key: string; text: string };

const BATCH_SIZE = 8;

function buildSystem(language: string): string {
  return (
    "You are an expert educational editor for Dutch MBO textbooks.\n" +
    "Goal: rewrite text to match an N3 voice: practical, student-friendly, short sentences, 'je' form.\n" +
    "Preserve meaning and factual correctness.\n" +
    "TERMINOLOGY (NON-NEGOTIABLE):\n" +
    "- Use 'zorgvrager' (NEVER 'client'/'patient').\n" +
    "- Use 'zorgprofessional' (NEVER 'verpleegkundige').\n" +
    "HTML RULES:\n" +
    "- Input strings are INLINE HTML only (no <p> tags).\n" +
    "- Allowed tags: <strong>, <em>, <b>, <i>, <sup>, <sub>, <span>, <br/>.\n" +
    "- Do NOT introduce block tags (<p>, <div>, <h1>, etc.).\n" +
    "- Keep existing <strong> emphasis; add <strong> around key terms on first mention where helpful.\n" +
    "- Do NOT add labels like 'In de praktijk:' or 'Verdieping:'.\n" +
    `Language: ${language}\n`
  );
}

function buildPrompt(items: RewriteItem[]): string {
  return (
    'Return JSON: { "rewrites": [{"key": string, "text": string}, ...] }\n\n' +
    "REWRITE ITEMS:\n" +
    JSON.stringify({ items }, null, 2) +
    "\n\nRules:\n" +
    "- Return rewrites for EVERY input item (same keys).\n" +
    "- Do NOT return empty text.\n"
  );
}

function collectRewriteItems(sectionRaw: Record<string, unknown>): Array<{
  key: string;
  block: Record<string, unknown>;
  field: "basisHtml" | "praktijkHtml" | "verdiepingHtml";
  text: string;
}> {
  const out: Array<{ key: string; block: Record<string, unknown>; field: "basisHtml" | "praktijkHtml" | "verdiepingHtml"; text: string }> = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const v of node) walk(v); return; }
    const n = node as Record<string, unknown>;
    if (n.type === "paragraph") {
      const pid = typeof n.id === "string" ? n.id : "";
      if (!pid) return;
      for (const field of ["basisHtml", "praktijkHtml", "verdiepingHtml"] as const) {
        const text = typeof n[field] === "string" ? (n[field] as string).trim() : "";
        if (text) out.push({ key: `${pid}::${field}`, block: n, field, text });
      }
      return;
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(sectionRaw);
  return out;
}

export default class NormalizeVoice implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const chapter = job.chapter;
    if (chapter == null) throw new Error("BLOCKED: chapter is required for normalize_voice");

    const skeletonPath = job.input_artifacts.skeleton_json;
    if (!skeletonPath) throw new Error("BLOCKED: input_artifacts.skeleton_json is required");

    const modelSpec = job.input_artifacts.model || "anthropic:claude-sonnet-4-5-20250929";
    const { provider, model } = parseModelSpec(modelSpec);

    // State tracking via input_artifacts
    const sectionIndex = Number(job.input_artifacts.__voice_section ?? 0);
    const itemOffset = Number(job.input_artifacts.__voice_offset ?? 0);

    await emitJobEvent(job.id, job.book_id, "progress", 5, `Voice normalization: ch${chapter} sec${sectionIndex} offset=${itemOffset}`);

    const skeleton = await downloadJson<BookSkeletonV1>(skeletonPath);
    const v0 = validateBookSkeleton(skeleton);
    if (!v0.ok) throw new Error(`BLOCKED: Skeleton validation failed (${v0.issues.length} issues)`);

    const ch = skeleton.chapters[0];
    if (!ch) throw new Error("BLOCKED: skeleton has no chapters");

    const sections = ch.sections;

    // If past all sections, we're done
    if (sectionIndex >= sections.length) {
      return { ok: true, done: true, sectionsProcessed: sections.length };
    }

    const section = sections[sectionIndex]!;
    const allItems = collectRewriteItems(section as unknown as Record<string, unknown>);

    // If no items in this section, advance
    if (allItems.length === 0 || itemOffset >= allItems.length) {
      const nextInput = { ...job.input_artifacts, __voice_section: String(sectionIndex + 1), __voice_offset: "0" };
      const yieldResult: YieldResult = {
        yield: true,
        message: `Section ${sectionIndex + 1}/${sections.length} done; advancing`,
        nextInputArtifacts: nextInput,
        progress: Math.floor(((sectionIndex + 1) / sections.length) * 90),
      };
      // Save skeleton at section boundary
      await uploadJson(skeletonPath, skeleton);
      return yieldResult;
    }

    // Take a batch
    const slice = allItems.slice(itemOffset, itemOffset + BATCH_SIZE);
    const items: RewriteItem[] = slice.map((x) => ({ key: x.key, text: x.text }));

    const system = buildSystem(skeleton.meta.language || "nl");
    const prompt = buildPrompt(items);

    const raw = await withRetries(`voice-ch${chapter}-s${sectionIndex}-o${itemOffset}`, async () =>
      llmChatComplete({
        provider, model, temperature: 0.2,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        maxTokens: 2500,
        jsonMode: provider === "openai",
      })
    );

    let parsed: { rewrites: Array<{ key: string; text: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("BLOCKED: Voice rewrite returned invalid JSON");
    }

    const outMap = new Map<string, string>();
    for (const r of parsed.rewrites ?? []) {
      if (r.key && r.text) outMap.set(r.key, r.text);
    }

    if (outMap.size !== items.length) {
      throw new Error(`BLOCKED: Voice rewrite returned incomplete batch (got=${outMap.size}, expected=${items.length})`);
    }

    // Apply rewrites
    for (const it of slice) {
      const next = outMap.get(it.key);
      if (!next) throw new Error(`BLOCKED: Missing rewrite for key '${it.key}'`);
      it.block[it.field] = next;
    }

    const doneItems = Math.min(allItems.length, itemOffset + slice.length);
    const sectionDone = doneItems >= allItems.length;

    if (sectionDone) {
      await uploadJson(skeletonPath, skeleton);
    }

    const nextInput = {
      ...job.input_artifacts,
      __voice_section: sectionDone ? String(sectionIndex + 1) : String(sectionIndex),
      __voice_offset: sectionDone ? "0" : String(itemOffset + BATCH_SIZE),
    };

    return {
      yield: true,
      message: sectionDone
        ? `Section ${sectionIndex + 1}/${sections.length} normalized`
        : `Applied ${doneItems}/${allItems.length} in section ${sectionIndex + 1}/${sections.length}`,
      nextInputArtifacts: nextInput,
      progress: Math.floor(((sectionIndex + (doneItems / allItems.length)) / sections.length) * 90),
    };
  }
}

