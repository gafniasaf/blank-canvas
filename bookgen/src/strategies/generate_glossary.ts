/**
 * generate_glossary strategy
 *
 * Generates a Begrippenlijst (glossary) with definitions for a canonical book.
 * Ported from LearnPlay: supabase/functions/ai-job-runner/strategies/book_generate_glossary.ts
 *
 * Input:  assembled canonical book JSON
 * Output: glossary.generated.json with { items: [{ term, latin?, definition }] }
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson, artifactPath } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import { llmChatComplete, parseModelSpec, withRetries, extractJsonFromText } from "../llm.js";
import type { CanonicalBook } from "../schema/canonical.js";

function normalizeWs(s: string): string {
  return String(s || "").replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function extractTerminologyCandidates(text: string): string[] {
  const out: string[] = [];
  const re1 = /<<\s*BOLD_START\s*>>([\s\S]*?)<<\s*BOLD_END\s*>>/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text))) { const t = normalizeWs(m[1] ?? "").replace(/^[\s,.;:!?()[\]«»"']+/, "").replace(/[\s,.;:!?()[\]«»"']+$/, ""); if (t) out.push(t); }
  const re2 = /<\s*(strong|b)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;
  while ((m = re2.exec(text))) { const inner = normalizeWs((m[2] ?? "").replace(/<[^>]+>/g, " ")); const t = inner.replace(/^[\s,.;:!?()[\]«»"']+/, "").replace(/[\s,.;:!?()[\]«»"']+$/, ""); if (t) out.push(t); }
  return out;
}

function walkJsonStrings(value: unknown, visitor: (s: string) => void): void {
  if (!value) return;
  if (Array.isArray(value)) { for (const v of value) walkJsonStrings(v, visitor); return; }
  if (typeof value === "string") { visitor(value); return; }
  if (typeof value === "object") { for (const v of Object.values(value as Record<string, unknown>)) walkJsonStrings(v, visitor); }
}

export default class GenerateGlossary implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const canonicalPath = job.input_artifacts.canonical_json;
    if (!canonicalPath) throw new Error("BLOCKED: input_artifacts.canonical_json is required");

    const modelSpec = job.input_artifacts.model || "anthropic:claude-sonnet-4-5-20250929";
    const { provider, model } = parseModelSpec(modelSpec);

    await emitJobEvent(job.id, job.book_id, "progress", 5, "Loading canonical");
    const canonical = await downloadJson<CanonicalBook>(canonicalPath);

    const freq = new Map<string, { term: string; count: number }>();
    walkJsonStrings(canonical, (s) => {
      for (const t of extractTerminologyCandidates(s)) {
        const key = normalizeWs(t).toLowerCase();
        const prev = freq.get(key);
        if (!prev) freq.set(key, { term: t, count: 1 });
        else prev.count++;
      }
    });

    const candidates = Array.from(freq.values()).sort((a, b) => b.count - a.count).map((x) => x.term);
    if (candidates.length < 20) {
      throw new Error(`BLOCKED: Not enough terminology emphasis found (got ${candidates.length}, need >= 20)`);
    }

    const sample = candidates.slice(0, 250);
    await emitJobEvent(job.id, job.book_id, "progress", 20, `Drafting glossary from ${sample.length} terms`);

    const system =
      "Je bent een ervaren auteur voor Nederlandse MBO-studieboeken. " +
      "Je schrijft een Begrippenlijst met korte, leerlingvriendelijke definities. " +
      "Gebruik alleen termen uit de inputlijst (geen nieuwe termen verzinnen). " +
      "Houd definities compact (1-2 zinnen), duidelijk en in het Nederlands.";

    const prompt =
      `Boek: ${canonical.meta.title}\n` +
      `Kandidaat-termen: ${JSON.stringify(sample)}\n\n` +
      `Return JSON: { "items": [{ "term": string, "latin"?: string, "definition": string }] }\n` +
      `Regels: 60-140 items, alfabetisch, alleen termen uit de input.`;

    const raw = await withRetries("gen-glossary", async () =>
      llmChatComplete({ provider, model, temperature: 0.3, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], maxTokens: 8000, jsonMode: provider === "openai" })
    );

    const draft = extractJsonFromText(raw) as Record<string, unknown>;
    const itemsRaw = Array.isArray(draft?.items) ? draft.items : null;
    if (!itemsRaw) throw new Error("BLOCKED: LLM returned invalid glossary JSON (missing items[])");

    const seen = new Set<string>();
    const items = (itemsRaw as Array<Record<string, unknown>>)
      .map((it) => ({ term: typeof it.term === "string" ? normalizeWs(it.term) : "", latin: typeof it.latin === "string" ? normalizeWs(it.latin) : undefined, definition: typeof it.definition === "string" ? normalizeWs(it.definition) : "" }))
      .filter((it) => !!it.term && !!it.definition)
      .filter((it) => { const k = it.term.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.term.localeCompare(b.term, "nl"));

    if (items.length < 30) {
      throw new Error(`BLOCKED: Glossary too small (${items.length}, expected >= 30)`);
    }

    const versionId = job.input_artifacts.book_version_id || "v1";
    const outPath = artifactPath(job.book_id, versionId, "matter", "glossary.generated.json");
    await emitJobEvent(job.id, job.book_id, "progress", 85, `Saving glossary (${items.length} items)`);
    await uploadJson(outPath, { schemaVersion: "glossary_v1", bookId: job.book_id, language: "nl", generatedAt: new Date().toISOString(), items });

    return { ok: true, outPath, items: items.length };
  }
}

