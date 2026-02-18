/**
 * generate_chapter_recap strategy
 *
 * LLM generates learning objectives, a mini-glossary, and self-check questions
 * for a chapter based on its generated content.
 *
 * Ported from LearnPlay: queue-pump/src/strategies/book_generate_chapter.ts
 *
 * Input:  skeleton chapter JSON (fully generated)
 * Output: skeleton with recap fields populated
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import { llmChatComplete, parseModelSpec, withRetries, extractJsonFromText, type AnthropicToolSpec } from "../llm.js";
import type { BookSkeletonV1, SkeletonChapterRecap } from "../schema/skeleton.js";

const TOOL_DRAFT_RECAP: AnthropicToolSpec = {
  name: "draft_chapter_recap",
  description:
    "Draft high-quality learning objectives, a short glossary (with definitions), and self-check questions for a Dutch MBO chapter. " +
    "Use ONLY the provided chapter content summary and ONLY reference provided section IDs.",
  input_schema: {
    type: "object",
    additionalProperties: true,
    required: ["objectives", "glossary", "selfCheckQuestions"],
    properties: {
      objectives: {
        type: "array",
        items: {
          type: "object",
          required: ["text", "sectionId"],
          properties: {
            text: { type: "string" },
            sectionId: { type: "string" },
          },
        },
      },
      glossary: {
        type: "array",
        items: {
          type: "object",
          required: ["term", "definition", "sectionId"],
          properties: {
            term: { type: "string" },
            definition: { type: "string" },
            sectionId: { type: "string" },
          },
        },
      },
      selfCheckQuestions: {
        type: "array",
        items: {
          type: "object",
          required: ["question", "sectionId"],
          properties: {
            question: { type: "string" },
            sectionId: { type: "string" },
          },
        },
      },
    },
  },
};

function summarizeChapterContent(skeleton: BookSkeletonV1): string {
  const chapter = skeleton.chapters[0];
  if (!chapter) return "";

  const lines: string[] = [`Hoofdstuk ${chapter.chapterNumber}: ${chapter.title}`];
  for (const sec of chapter.sections) {
    lines.push(`\n## ${sec.id} ${sec.title}`);
      for (const block of sec.blocks ?? []) {
      if (block.type === "paragraph") {
        const text = (block.basisHtml || "").replace(/<[^>]+>/g, "").slice(0, 200);
        if (text.trim()) lines.push(`- ${text.trim()}`);
      } else if (block.type === "subparagraph") {
        lines.push(`  ### ${block.title}`);
        for (const inner of block.blocks ?? []) {
          if (inner.type === "paragraph") {
            const text = (inner.basisHtml || "").replace(/<[^>]+>/g, "").slice(0, 150);
            if (text.trim()) lines.push(`  - ${text.trim()}`);
          }
        }
      }
    }
  }
  return lines.join("\n");
}

export default class GenerateChapterRecap implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const chapter = job.chapter;
    if (chapter == null) throw new Error("BLOCKED: chapter is required for generate_chapter_recap");

    const skeletonPath = job.input_artifacts.skeleton_json;
    if (!skeletonPath) throw new Error("BLOCKED: input_artifacts.skeleton_json is required");

    const modelSpec = job.input_artifacts.model || "anthropic:claude-sonnet-4-5-20250929";
    const { provider, model } = parseModelSpec(modelSpec);

    await emitJobEvent(job.id, job.book_id, "progress", 10, "Loading skeleton");
    const skeleton = await downloadJson<BookSkeletonV1>(skeletonPath);

    if (!skeleton.chapters[0]) throw new Error("BLOCKED: skeleton has no chapters");

    const summary = summarizeChapterContent(skeleton);
    const sectionIds = skeleton.chapters[0].sections.map((s) => s.id);

    await emitJobEvent(job.id, job.book_id, "progress", 25, `Generating recap for chapter ${chapter}`);

    const system =
      "Je bent een ervaren auteur voor Nederlandse MBO-studieboeken.\n" +
      "Je maakt een samenvatting met leerdoelen, kernbegrippen en zelftoetsvragen voor een hoofdstuk.\n" +
      "Schrijf in het Nederlands, helder en leerlingvriendelijk.\n" +
      "Gebruik alleen termen uit de input. Verwijs ALLEEN naar bestaande section IDs.";

    const prompt =
      `INHOUD VAN HET HOOFDSTUK:\n${summary}\n\n` +
      `BESCHIKBARE SECTION IDs: ${JSON.stringify(sectionIds)}\n\n` +
      "TAAK: Genereer:\n" +
      "1. 5-8 leerdoelen (objectives) — concrete, toetsbare doelen\n" +
      "2. 8-15 kernbegrippen (glossary) met korte definities\n" +
      "3. 5-8 zelftoetsvragen (selfCheckQuestions) — open vragen om begrip te toetsen\n\n" +
      "Elke entry MOET een sectionId hebben die bestaat in de lijst hierboven.\n";

    const raw = await withRetries(`recap-ch${chapter}`, async () =>
      llmChatComplete({
        provider,
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        maxTokens: 3000,
        tools: provider === "anthropic" ? [TOOL_DRAFT_RECAP] : undefined,
        toolChoice: provider === "anthropic" ? { type: "tool", name: TOOL_DRAFT_RECAP.name } : undefined,
        jsonMode: provider === "openai",
      })
    );

    await emitJobEvent(job.id, job.book_id, "progress", 70, "Parsing recap output");

    let parsed: SkeletonChapterRecap;
    try {
      parsed = extractJsonFromText(raw) as SkeletonChapterRecap;
    } catch {
      throw new Error(`BLOCKED: Failed to parse recap JSON for chapter ${chapter}`);
    }

    // Validate that section IDs reference real sections
    const validIds = new Set(sectionIds);
    const filterValid = <T extends { sectionId?: string }>(items: T[] | undefined): T[] =>
      (items ?? []).filter((item) => !item.sectionId || validIds.has(item.sectionId));

    const recap: SkeletonChapterRecap = {
      objectives: filterValid(parsed.objectives),
      glossary: filterValid(parsed.glossary),
      selfCheckQuestions: filterValid(parsed.selfCheckQuestions),
    };

    skeleton.chapters[0].recap = recap;

    await emitJobEvent(job.id, job.book_id, "progress", 85, "Saving skeleton with recap");
    await uploadJson(skeletonPath, skeleton);

    return {
      ok: true,
      objectives: recap.objectives?.length ?? 0,
      glossary: recap.glossary?.length ?? 0,
      selfCheckQuestions: recap.selfCheckQuestions?.length ?? 0,
    };
  }
}

