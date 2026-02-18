/**
 * generate_section strategy
 *
 * LLM-powered section content generation with microheadings.
 * Merges:
 * - TestRun prompts (MBO N3 style, "je" form, fact preservation, terminology)
 * - LearnPlay microheading density (low/medium/high)
 * - LearnPlay tool_use for structured JSON output
 *
 * Input:  skeleton chapter JSON + section index
 * Output: updated skeleton with generated content for this section
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import { llmChatComplete, parseModelSpec, withRetries, extractJsonFromText, type AnthropicToolSpec } from "../llm.js";
import type { BookSkeletonV1, SkeletonBlock } from "../schema/skeleton.js";
import { validateBookSkeleton } from "../schema/skeleton.js";

type MicroheadingDensity = "low" | "medium" | "high";

const TOOL_DRAFT_SECTION: AnthropicToolSpec = {
  name: "draft_section_content",
  description:
    "Return a JSON object with { blocks: DraftBlock[] }. " +
    "blocks MUST be a non-empty array of paragraph/list/steps/subparagraph blocks. " +
    "Each paragraph block has { type, basisHtml, praktijkHtml?, verdiepingHtml? }. " +
    "basisHtml is 2-4 short sentences for a microheading; inline HTML only.",
  input_schema: {
    type: "object",
    additionalProperties: true,
    required: ["blocks"],
    properties: {
      blocks: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
    },
  },
};

function buildSystemPrompt(opts: {
  language: string;
  level: "n3" | "n4";
  microheadingDensity: MicroheadingDensity;
}): string {
  const { level, microheadingDensity } = opts;

  const depthGuidance = level === "n3"
    ? "Depth policy (MBO N3): keep it practical and accessible.\n- Avoid heavy theory-dumps.\n- Do NOT introduce advanced equations/constants unless the topic truly requires it.\n"
    : "Depth policy (MBO N4): you may go slightly deeper, but stay teachable.\n- You may include at most ONE simple formula OR named law if it helps learning.\n";

  // Core system prompt merged from TestRun's generate-from-skeleton.ts + LearnPlay's section gen
  return (
    "You are BookGen Pro.\n" +
    "You write educational book sections as inline HTML strings (no <p> tags).\n" +
    "Allowed inline tags: <strong>, <em>, <b>, <i>, <sup>, <sub>, <span>, <br/>.\n" +
    "Output MUST be valid JSON ONLY (no markdown).\n\n" +
    "TARGET AUDIENCE: MBO healthcare students (zorg domain).\n" +
    "WRITING STYLE:\n" +
    "- Short sentences. Active voice. Address the reader as 'je'.\n" +
    "- Define terms the first time you use them.\n" +
    "- Simplify complex details into accessible explanations.\n" +
    "- Terminology emphasis (REQUIRED): wrap key terms in <strong> on first mention.\n\n" +
    "TERMINOLOGY (NON-NEGOTIABLE):\n" +
    "- Use 'zorgvrager' (NEVER 'cliënt', 'client', 'patiënt', 'patient').\n" +
    "- Use 'zorgprofessional' (NEVER 'verpleegkundige').\n\n" +
    `Microheading density: ${microheadingDensity}\n` +
    "- Do NOT include the labels 'In de praktijk:' or 'Verdieping:' in the text; the renderer adds them.\n" +
    "- For praktijk/verdieping: start with a short lead phrase wrapped as <span class=\"box-lead\">...</span>.\n\n" +
    depthGuidance +
    `Book language: ${opts.language}\n`
  );
}

function buildUserPrompt(opts: {
  bookTitle: string;
  chapterNumber: number;
  sectionNumber: string;
  sectionTitle: string;
  requiredSubparagraphTitles: string[];
  microheadingDensity: MicroheadingDensity;
}): string {
  const required = opts.requiredSubparagraphTitles.filter(Boolean);

  return (
    `BOOK: ${opts.bookTitle}\n` +
    `CHAPTER: ${opts.chapterNumber}\n` +
    `SECTION: ${opts.sectionNumber} ${opts.sectionTitle}\n\n` +
    (required.length
      ? `REQUIRED SUBPARAGRAPH TITLES (use these exact titles as subparagraph headings):\n${required.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}\n\n`
      : "") +
    "TASK: Write the full section content.\n" +
    "- Each subparagraph should have 2-5 paragraph blocks with microheadings.\n" +
    "- Include at least one praktijk (practical application) per subparagraph where relevant.\n" +
    "- Include verdieping (deeper explanation) for 1-2 subparagraphs where it adds value.\n" +
    "- Use bullet lists sparingly and only for enumerations.\n\n" +
    "Return JSON: { blocks: DraftBlock[] }\n" +
    "Write now (Dutch):"
  );
}

export default class GenerateSection implements JobExecutor {
  /**
   * Parse LLM output into blocks, handling various response shapes.
   */
  private parseBlocks(raw: string, sectionId: string): SkeletonBlock[] {
    let parsed: { blocks: SkeletonBlock[] };
    try {
      const extracted = extractJsonFromText(raw);
      if (extracted && typeof extracted === "object") {
        const obj = extracted as Record<string, unknown>;
        if (Array.isArray(obj.blocks)) {
          parsed = { blocks: obj.blocks as SkeletonBlock[] };
        } else if (Array.isArray(extracted)) {
          parsed = { blocks: extracted as SkeletonBlock[] };
        } else {
          const keys = Object.keys(obj);
          const arrKey = keys.find((k) => Array.isArray(obj[k]));
          if (arrKey) {
            parsed = { blocks: obj[arrKey] as SkeletonBlock[] };
          } else {
            // Deep search for nested blocks array
            const deepSearch = (o: unknown): SkeletonBlock[] | null => {
              if (!o || typeof o !== "object") return null;
              if (Array.isArray(o)) return o.length > 0 && typeof o[0] === "object" ? o as SkeletonBlock[] : null;
              for (const v of Object.values(o as Record<string, unknown>)) {
                if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v as SkeletonBlock[];
                const found = deepSearch(v);
                if (found) return found;
              }
              return null;
            };
            const deepBlocks = deepSearch(obj);
            if (deepBlocks) {
              parsed = { blocks: deepBlocks };
            } else {
              throw new Error("No blocks array found in LLM output");
            }
          }
        }
      } else {
        throw new Error("LLM output is not an object");
      }
    } catch (e) {
      console.error(`[generate_section] Raw LLM output (first 500 chars): ${raw.slice(0, 500)}`);
      throw new Error(`Failed to parse LLM JSON for section ${sectionId}: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!Array.isArray(parsed?.blocks) || parsed.blocks.length === 0) {
      throw new Error(`LLM returned empty blocks for section ${sectionId}`);
    }

    return parsed.blocks;
  }

  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const skeletonPath = job.input_artifacts.skeleton_json;
    if (!skeletonPath) throw new Error("BLOCKED: input_artifacts.skeleton_json is required");

    const modelSpec = job.input_artifacts.model || "anthropic:claude-sonnet-4-5-20250929";
    const { provider, model } = parseModelSpec(modelSpec);
    const microheadingDensity = (job.input_artifacts.microheading_density as MicroheadingDensity) || "medium";

    await emitJobEvent(job.id, job.book_id, "progress", 5, "Loading skeleton");
    const skeleton = await downloadJson<BookSkeletonV1>(skeletonPath);

    const chapter = skeleton.chapters[0];
    if (!chapter) throw new Error("BLOCKED: skeleton has no chapters");

    const sections = chapter.sections;
    const totalSections = sections.length;
    console.log(`[generate_section] Ch ${chapter.chapterNumber}: processing ${totalSections} sections`);

    const systemPrompt = buildSystemPrompt({
      language: skeleton.meta.language || "nl",
      level: skeleton.meta.level,
      microheadingDensity,
    });

    let totalBlocks = 0;
    const failures: string[] = [];

    // Iterate through ALL sections in the chapter
    for (let si = 0; si < totalSections; si++) {
      const section = sections[si];
      const sectionId = section.id;

      // Check if section already has generated content (resume support)
      const hasGenerated = section.blocks.some(
        (b) => typeof (b as Record<string, unknown>).basisHtml === "string"
      );
      if (hasGenerated) {
        console.log(`[generate_section] Section ${sectionId} already generated — skipping`);
        continue;
      }

      const progressPct = Math.round(10 + (80 * si) / totalSections);
      await emitJobEvent(
        job.id, job.book_id, "progress", progressPct,
        `Generating section ${sectionId} (${si + 1}/${totalSections})`
      );

      const subTitles = section.blocks
        .filter((b) => b.type === "subparagraph")
        .map((b) => (b as { title: string }).title)
        .filter(Boolean);

      const userPrompt = buildUserPrompt({
        bookTitle: skeleton.meta.title,
        chapterNumber: chapter.chapterNumber,
        sectionNumber: sectionId,
        sectionTitle: section.title,
        requiredSubparagraphTitles: subTitles,
        microheadingDensity,
      });

      // Retry up to 3 times for each section — plain JSON mode (no tool_use)
      let sectionBlocks: SkeletonBlock[] | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const raw = await withRetries(`gen-section-${sectionId}`, async () => {
            return llmChatComplete({
              provider,
              model,
              temperature: 0.3 + (attempt - 1) * 0.1,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              maxTokens: 16384,
              jsonMode: true,
            });
          });

          sectionBlocks = this.parseBlocks(raw, sectionId);
          break; // success
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[generate_section] Section ${sectionId} attempt ${attempt}/3 failed: ${msg}`);
          if (attempt === 3) {
            failures.push(`${sectionId}: ${msg}`);
          }
        }
      }

      if (!sectionBlocks) continue;

      // Assign IDs to generated blocks
      let blockCounter = 0;
      function assignIds(blocks: unknown[]): void {
        if (!Array.isArray(blocks)) return;
        for (const block of blocks) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "subparagraph") {
            if (Array.isArray(b.blocks)) assignIds(b.blocks);
          } else if (!b.id) {
            b.id = `${sectionId}_gen_${blockCounter++}`;
          }
        }
      }
      assignIds(sectionBlocks);

      // Replace the section's blocks with generated content
      chapter.sections[si] = { ...section, blocks: sectionBlocks };
      totalBlocks += sectionBlocks.length;

      // Save after each section (checkpoint — allows resume)
      await uploadJson(skeletonPath, skeleton);
      console.log(`[generate_section] ✅ Section ${sectionId}: ${sectionBlocks.length} blocks`);
    }

    if (failures.length > 0 && failures.length === totalSections) {
      throw new Error(`BLOCKED: All ${totalSections} sections failed: ${failures.join("; ")}`);
    }

    // Final validation
    const validation = validateBookSkeleton(skeleton);
    if (!validation.ok) {
      const errors = validation.issues.filter((i) => i.severity === "error");
      if (errors.length > 0) {
        console.warn(`[generate_section] Validation errors:`, errors);
      }
    }

    await emitJobEvent(job.id, job.book_id, "progress", 95, "All sections generated");
    await uploadJson(skeletonPath, skeleton);

    return {
      ok: true,
      chapter: chapter.chapterNumber,
      sectionsGenerated: totalSections - failures.length,
      sectionsFailed: failures.length,
      totalBlocks,
      provider,
      model,
    };
  }
}

