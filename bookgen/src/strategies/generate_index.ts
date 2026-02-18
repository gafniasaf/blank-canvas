/**
 * generate_index strategy
 *
 * Generates an index term list for a canonical book.
 * Ported from LearnPlay: supabase/functions/ai-job-runner/strategies/book_generate_index.ts
 *
 * Process:
 * 1. Walk the canonical JSON to extract bold-emphasized terms
 * 2. Send candidate terms to LLM for curation (alphabetical, deduplicated)
 * 3. Save index.generated.json to Storage
 *
 * Input:  assembled canonical book JSON
 * Output: index.generated.json with { entries: [{ term, variants?, seeAlso? }] }
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson, artifactPath } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import { llmChatComplete, parseModelSpec, withRetries, extractJsonFromText } from "../llm.js";
import type { CanonicalBook } from "../schema/canonical.js";

function normalizeWs(s: string): string {
  return String(s || "").replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function extractBoldTerms(text: string): string[] {
  const out: string[] = [];
  // Legacy markers
  const re1 = /<<\s*BOLD_START\s*>>([\s\S]*?)<<\s*BOLD_END\s*>>/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text))) {
    const t = normalizeWs(m[1] ?? "").replace(/^[\s,.;:!?()[\]«»"']+/, "").replace(/[\s,.;:!?()[\]«»"']+$/, "").trim();
    if (t) out.push(t);
  }
  // HTML <strong>/<b> tags
  const re2 = /<\s*(strong|b)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;
  while ((m = re2.exec(text))) {
    const inner = normalizeWs((m[2] ?? "").replace(/<[^>]+>/g, " "));
    const t = inner.replace(/^[\s,.;:!?()[\]«»"']+/, "").replace(/[\s,.;:!?()[\]«»"']+$/, "").trim();
    if (t) out.push(t);
  }
  return out;
}

function walkJsonStrings(value: unknown, visitor: (s: string) => void): void {
  if (!value) return;
  if (Array.isArray(value)) { for (const v of value) walkJsonStrings(v, visitor); return; }
  if (typeof value === "string") { visitor(value); return; }
  if (typeof value === "object") { for (const v of Object.values(value as Record<string, unknown>)) walkJsonStrings(v, visitor); }
}

export default class GenerateIndex implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const canonicalPath = job.input_artifacts.canonical_json;
    if (!canonicalPath) throw new Error("BLOCKED: input_artifacts.canonical_json is required");

    const modelSpec = job.input_artifacts.model || "anthropic:claude-sonnet-4-5-20250929";
    const { provider, model } = parseModelSpec(modelSpec);

    await emitJobEvent(job.id, job.book_id, "progress", 5, "Loading canonical");
    const canonical = await downloadJson<CanonicalBook>(canonicalPath);

    // Extract bold terms
    const freq = new Map<string, { term: string; count: number }>();
    walkJsonStrings(canonical, (s) => {
      for (const t of extractBoldTerms(s)) {
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

    const sample = candidates.slice(0, 350);
    await emitJobEvent(job.id, job.book_id, "progress", 20, `Drafting index from ${sample.length} candidate terms`);

    const system =
      "Je bent een ervaren indexredacteur voor Nederlandse MBO-studieboeken. " +
      "Je taak is om een bruikbare trefwoordenlijst (index) samen te stellen op basis van bestaande termen in het boek. " +
      "Gebruik alleen termen die in de input voorkomen (geen nieuwe termen verzinnen). " +
      "Geen paginanummers in deze output; die worden later berekend.";

    const prompt =
      `Boek: ${canonical.meta.title}\n` +
      `Kandidaat-termen: ${JSON.stringify(sample)}\n\n` +
      `Return JSON: { "entries": [{ "term": string, "variants"?: string[], "seeAlso"?: string[] }] }\n` +
      `Regels: 150-300 entries, alfabetisch, geen dubbelen, geen paginanummers.`;

    const raw = await withRetries("gen-index", async () =>
      llmChatComplete({ provider, model, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], maxTokens: 7000, jsonMode: provider === "openai" })
    );

    const draft = extractJsonFromText(raw) as Record<string, unknown>;
    let entriesRaw = Array.isArray(draft?.entries) ? draft.entries : candidates.slice(0, 600).map((t) => ({ term: t }));

    // Normalize + dedupe
    const seen = new Set<string>();
    const entries = (entriesRaw as Array<Record<string, unknown>>)
      .map((e) => ({ term: typeof e.term === "string" ? normalizeWs(e.term) : "", variants: Array.isArray(e.variants) ? e.variants.filter((x: unknown) => typeof x === "string").map(normalizeWs) : undefined, seeAlso: Array.isArray(e.seeAlso) ? e.seeAlso.filter((x: unknown) => typeof x === "string").map(normalizeWs) : undefined }))
      .filter((e) => !!e.term)
      .filter((e) => { const k = e.term.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.term.localeCompare(b.term, "nl"));

    const versionId = job.input_artifacts.book_version_id || "v1";
    const outPath = artifactPath(job.book_id, versionId, "matter", "index.generated.json");
    await emitJobEvent(job.id, job.book_id, "progress", 85, `Saving index (${entries.length} entries)`);
    await uploadJson(outPath, { schemaVersion: "index_v1", bookId: job.book_id, language: "nl", generatedAt: new Date().toISOString(), entries });

    return { ok: true, outPath, entries: entries.length };
  }
}

