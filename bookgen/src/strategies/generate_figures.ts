/**
 * generate_figures strategy
 *
 * Uses an LLM to plan figure placements for each section, then:
 * 1. Generates styled placeholder PNGs for each planned figure
 * 2. Generates chapter opener placeholder PNGs
 * 3. Injects figure blocks into the canonical chapter JSON
 *
 * Input:  assembled chapter canonical JSON (from assemble_chapter)
 * Output: updated canonical JSON with figure blocks + placeholder images in Storage
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson, uploadFile, artifactPath } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import { llmChatComplete, parseModelSpec, withRetries, extractJsonFromText, type AnthropicToolSpec } from "../llm.js";
import type { CanonicalBook, CanonicalChapter, CanonicalSection, ContentBlock, CanonicalImage } from "../schema/canonical.js";
import { createCanvas } from "@napi-rs/canvas";

// =============================================================================
// Types
// =============================================================================

interface PlannedFigure {
  figureNumber: string;
  caption: string;
  placement: "after_block_id" | "even_spread";
  blockId?: string;
  description: string;
}

interface FigurePlan {
  figures: PlannedFigure[];
}

// =============================================================================
// LLM Tool Definition
// =============================================================================

const TOOL_PLAN_FIGURES: AnthropicToolSpec = {
  name: "plan_figures",
  description: "Plan figure placements for a book section based on its content.",
  input_schema: {
    type: "object",
    properties: {
      figures: {
        type: "array",
        items: {
          type: "object",
          properties: {
            figureNumber: { type: "string", description: "Figure number like '1.1', '1.2', '2.1'" },
            caption: { type: "string", description: "Dutch caption describing what the figure shows" },
            placement: { type: "string", enum: ["after_block_id", "even_spread"], description: "Where to place the figure" },
            blockId: { type: "string", description: "Block ID to place figure after (if placement=after_block_id)" },
            description: { type: "string", description: "English description for future AI image generation" },
          },
          required: ["figureNumber", "caption", "description"],
        },
      },
    },
    required: ["figures"],
  },
};

// =============================================================================
// LLM Prompts
// =============================================================================

function buildSystemPrompt(): string {
  return (
    "You are a figure planning assistant for Dutch MBO healthcare textbooks.\n\n" +
    "Your job is to decide where figures (images, diagrams, illustrations) should be placed in a book section.\n\n" +
    "RULES:\n" +
    "- Suggest 0-3 figures per section based on content density and visual potential.\n" +
    "- Figures should illustrate key concepts, processes, or practical applications.\n" +
    "- Each figure needs a Dutch caption and an English description for image generation.\n" +
    "- Captions should be informative and student-friendly.\n" +
    "- Descriptions should be specific enough for an AI image generator.\n" +
    "- Use figure numbers in format: <chapter>.<sequential> (e.g. 1.1, 1.2, 2.1).\n" +
    "- Place figures near the content they illustrate.\n" +
    "- For practical/medical content: diagrams, anatomical illustrations, workflow charts.\n" +
    "- For theoretical content: concept maps, comparison tables as images, infographics.\n" +
    "- Do NOT suggest figures for every paragraph — only where a visual truly helps learning.\n\n" +
    "OUTPUT: JSON only via the plan_figures tool.\n"
  );
}

function buildUserPrompt(opts: {
  bookTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  sectionNumber: string;
  sectionTitle: string;
  sectionContent: string;
  existingFigureCount: number;
}): string {
  return (
    `BOOK: ${opts.bookTitle}\n` +
    `CHAPTER ${opts.chapterNumber}: ${opts.chapterTitle}\n` +
    `SECTION ${opts.sectionNumber}: ${opts.sectionTitle}\n\n` +
    `Existing figures in this chapter so far: ${opts.existingFigureCount}\n\n` +
    `SECTION CONTENT:\n${opts.sectionContent}\n\n` +
    "Plan figures for this section. Use figure numbers starting from " +
    `${opts.chapterNumber}.${opts.existingFigureCount + 1}.\n` +
    "Suggest 0-3 figures based on visual potential. If the content is purely textual and doesn't benefit from illustrations, suggest 0 figures.\n"
  );
}

// =============================================================================
// Placeholder PNG Generation
// =============================================================================

const PLACEHOLDER_WIDTH = 640;
const PLACEHOLDER_HEIGHT = 400;
const OPENER_WIDTH = 794;  // ~210mm at 96dpi (A4 width)
const OPENER_HEIGHT = 1123; // ~297mm at 96dpi (A4 height)

function generatePlaceholderPng(figureNumber: string, caption: string): Buffer {
  const canvas = createCanvas(PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT);
  const ctx = canvas.getContext("2d");

  // Light gray background
  ctx.fillStyle = "#f0f2f5";
  ctx.fillRect(0, 0, PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT);

  // Green header bar
  ctx.fillStyle = "#2d7a4e";
  ctx.fillRect(0, 0, PLACEHOLDER_WIDTH, 52);

  // Figure number in header
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(`Afbeelding ${figureNumber}`, 20, 35);

  // Camera icon placeholder (simple shapes)
  const cx = PLACEHOLDER_WIDTH / 2;
  const cy = PLACEHOLDER_HEIGHT / 2 - 20;
  ctx.strokeStyle = "#b0b8c4";
  ctx.lineWidth = 3;

  // Camera body
  ctx.beginPath();
  ctx.roundRect(cx - 50, cy - 30, 100, 70, 8);
  ctx.stroke();

  // Lens circle
  ctx.beginPath();
  ctx.arc(cx, cy + 5, 22, 0, Math.PI * 2);
  ctx.stroke();

  // Flash
  ctx.beginPath();
  ctx.moveTo(cx - 15, cy - 30);
  ctx.lineTo(cx - 10, cy - 42);
  ctx.lineTo(cx + 10, cy - 42);
  ctx.lineTo(cx + 15, cy - 30);
  ctx.stroke();

  // "Placeholder" label
  ctx.fillStyle = "#8896a7";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Afbeelding wordt later gegenereerd", cx, cy + 65);

  // Caption at bottom
  ctx.fillStyle = "#333333";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "left";

  // Word-wrap caption
  const maxWidth = PLACEHOLDER_WIDTH - 40;
  const words = caption.split(" ");
  let line = "";
  let y = PLACEHOLDER_HEIGHT - 50;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line, 20, y);
      line = word;
      y += 18;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, 20, y);

  return Buffer.from(canvas.toBuffer("image/png"));
}

function generateChapterOpenerPng(chapterNumber: number, chapterTitle: string): Buffer {
  const canvas = createCanvas(OPENER_WIDTH, OPENER_HEIGHT);
  const ctx = canvas.getContext("2d");

  // Gradient background (green to dark blue)
  const grad = ctx.createLinearGradient(0, 0, 0, OPENER_HEIGHT);
  grad.addColorStop(0, "#2d7a4e");
  grad.addColorStop(1, "#1a365d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, OPENER_WIDTH, OPENER_HEIGHT);

  // Subtle pattern overlay (diagonal lines)
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let i = -OPENER_HEIGHT; i < OPENER_WIDTH + OPENER_HEIGHT; i += 30) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + OPENER_HEIGHT, OPENER_HEIGHT);
    ctx.stroke();
  }

  // Content at bottom
  const bottomY = OPENER_HEIGHT - 120;

  // "Hoofdstuk" label
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("HOOFDSTUK", 50, bottomY - 160);

  // Large chapter number
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 120px sans-serif";
  ctx.fillText(String(chapterNumber), 50, bottomY - 30);

  // Chapter title (word-wrapped)
  ctx.font = "bold 36px sans-serif";
  const maxWidth = OPENER_WIDTH - 100;
  const words = chapterTitle.split(" ");
  let line = "";
  let y = bottomY + 10;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line, 50, y);
      line = word;
      y += 44;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, 50, y);

  return Buffer.from(canvas.toBuffer("image/png"));
}

// =============================================================================
// Content helpers
// =============================================================================

/** Collect all text from a section's content blocks for the LLM prompt */
function summarizeSectionContent(section: CanonicalSection): string {
  const parts: string[] = [];

  function walk(blocks: ContentBlock[]): void {
    if (!blocks || !Array.isArray(blocks)) return;
    for (const b of blocks) {
      const any = b as any;
      if (any.basis) parts.push(String(any.basis).replace(/<[^>]+>/g, "").slice(0, 300));
      if (any.praktijk) parts.push(`[Praktijk] ${String(any.praktijk).replace(/<[^>]+>/g, "").slice(0, 200)}`);
      if (any.verdieping) parts.push(`[Verdieping] ${String(any.verdieping).replace(/<[^>]+>/g, "").slice(0, 200)}`);
      if (any.items && Array.isArray(any.items)) {
        for (const item of any.items) {
          const text = typeof item === "string" ? item : item?.text ?? "";
          parts.push(`- ${String(text).replace(/<[^>]+>/g, "").slice(0, 150)}`);
        }
      }
      if (any.content && Array.isArray(any.content)) walk(any.content);
      if (any.blocks && Array.isArray(any.blocks)) walk(any.blocks);
    }
  }

  walk(section.content);
  // Limit total length for the LLM prompt
  return parts.join("\n").slice(0, 3000);
}

/** Collect all block IDs from a section for placement validation */
function collectBlockIds(section: CanonicalSection): string[] {
  const ids: string[] = [];
  function walk(blocks: ContentBlock[]): void {
    if (!blocks || !Array.isArray(blocks)) return;
    for (const b of blocks) {
      const any = b as any;
      if (any.id) ids.push(any.id);
      if (any.content && Array.isArray(any.content)) walk(any.content);
      if (any.blocks && Array.isArray(any.blocks)) walk(any.blocks);
    }
  }
  walk(section.content);
  return ids;
}

/** Inject a figure block after a specific block ID or evenly spread in a section */
function injectFigureBlocks(
  section: CanonicalSection,
  figures: Array<{ figureNumber: string; caption: string; src: string; blockId?: string }>
): void {
  if (!figures.length) return;

  // Split: targeted placements vs even-spread
  const targeted = figures.filter((f) => f.blockId);
  const spread = figures.filter((f) => !f.blockId);

  // Inject targeted figures after their specified block
  for (const fig of targeted) {
    const figBlock: ContentBlock = {
      type: "image" as any,
      id: `fig-${fig.figureNumber}`,
      src: fig.src,
      alt: fig.caption,
      caption: fig.caption,
      figureNumber: `Afbeelding ${fig.figureNumber}`,
    } as any;

    // Find the block and insert after it
    insertAfterBlockId(section.content, fig.blockId!, figBlock);
  }

  // Inject spread figures evenly
  if (spread.length > 0) {
    const content = section.content;
    const step = Math.max(1, Math.floor(content.length / (spread.length + 1)));
    let offset = 0;
    for (let i = 0; i < spread.length; i++) {
      const pos = Math.min(content.length, step * (i + 1) + offset);
      const figBlock: ContentBlock = {
        type: "image" as any,
        id: `fig-${spread[i].figureNumber}`,
        src: spread[i].src,
        alt: spread[i].caption,
        caption: spread[i].caption,
        figureNumber: `Afbeelding ${spread[i].figureNumber}`,
      } as any;
      content.splice(pos, 0, figBlock);
      offset++; // account for the insertion shifting indices
    }
  }
}

function insertAfterBlockId(blocks: ContentBlock[], targetId: string, toInsert: ContentBlock): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as any;
    if (b.id === targetId) {
      blocks.splice(i + 1, 0, toInsert);
      return true;
    }
    // Recurse into subparagraph content
    if (b.content && Array.isArray(b.content)) {
      if (insertAfterBlockId(b.content, targetId, toInsert)) return true;
    }
    if (b.blocks && Array.isArray(b.blocks)) {
      if (insertAfterBlockId(b.blocks, targetId, toInsert)) return true;
    }
  }
  return false;
}

// =============================================================================
// Strategy
// =============================================================================

export default class GenerateFigures implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const versionId = job.input_artifacts.book_version_id || "v1";
    const chapterNum = job.chapter;
    if (chapterNum == null) throw new Error("BLOCKED: chapter is required for generate_figures");

    const modelSpec = job.input_artifacts.model || "anthropic:claude-sonnet-4-5-20250929";
    const { provider, model } = parseModelSpec(modelSpec);

    await emitJobEvent(job.id, job.book_id, "progress", 5, `Loading chapter ${chapterNum} canonical`);

    // Load chapter canonical JSON
    const chPath = artifactPath(job.book_id, versionId, `canonical_ch${chapterNum}.json`);
    const chCanonical = await downloadJson<CanonicalBook>(chPath);

    const chapter = chCanonical.chapters?.[0];
    if (!chapter) throw new Error(`BLOCKED: No chapter found in canonical for ch${chapterNum}`);

    const bookTitle = chCanonical.meta?.title || job.book_id;
    const bookSlug = bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

    // =========================================================================
    // Step 1: Generate chapter opener placeholder
    // =========================================================================
    await emitJobEvent(job.id, job.book_id, "progress", 10, "Generating chapter opener");

    const openerPng = generateChapterOpenerPng(chapterNum, chapter.title);
    const openerStoragePath = artifactPath(
      job.book_id, versionId,
      `assets/chapter_openers/chapter_${chapterNum}_opener.png`
    );
    await uploadFile(openerStoragePath, openerPng, "image/png");

    // Also save locally for the renderer
    // The renderer's REPO_ROOT is the TestRun directory (parent of bookgen/).
    // This strategy lives in bookgen/src/strategies/, so go up 3 levels.
    const fs = await import("fs");
    const path = await import("path");
    const repoRoot = path.resolve(
      new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
      "../../.."
    );
    const localOpenerDir = path.resolve(repoRoot, "new_pipeline/assets/books", bookSlug, "chapter_openers");
    fs.mkdirSync(localOpenerDir, { recursive: true });
    const localOpenerPath = path.resolve(localOpenerDir, `chapter_${chapterNum}_opener.png`);
    fs.writeFileSync(localOpenerPath, openerPng);

    // Inject opener image into chapter
    const openerRelPath = `new_pipeline/assets/books/${bookSlug}/chapter_openers/chapter_${chapterNum}_opener.png`;
    chapter.images = [{ src: openerRelPath, alt: `Hoofdstuk ${chapterNum} opener`, width: "100%" }];

    console.log(`✅ Chapter ${chapterNum} opener saved: ${localOpenerPath}`);

    // =========================================================================
    // Step 2: LLM plans figures per section
    // =========================================================================
    await emitJobEvent(job.id, job.book_id, "progress", 20, "Planning figures with LLM");

    let totalFigures = 0;
    const allPlannedFigures: Array<{
      sectionIdx: number;
      figure: PlannedFigure;
      src: string;
    }> = [];

    const systemPrompt = buildSystemPrompt();

    for (let si = 0; si < chapter.sections.length; si++) {
      const section = chapter.sections[si];
      const sectionContent = summarizeSectionContent(section);
      const blockIds = collectBlockIds(section);

      const progress = 20 + Math.round((si / chapter.sections.length) * 40);
      await emitJobEvent(job.id, job.book_id, "progress", progress,
        `Planning figures for section ${section.number}`);

      const userPrompt = buildUserPrompt({
        bookTitle,
        chapterNumber: chapterNum,
        chapterTitle: chapter.title,
        sectionNumber: section.number,
        sectionTitle: section.title || "",
        sectionContent,
        existingFigureCount: totalFigures,
      });

      let plan: FigurePlan;
      try {
        const raw = await withRetries(`plan-figures-${section.number}`, () =>
          llmChatComplete({
            provider,
            model,
            temperature: 0.3,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            maxTokens: 2048,
            tools: provider === "anthropic" ? [TOOL_PLAN_FIGURES] : undefined,
            toolChoice: provider === "anthropic" ? { type: "tool", name: TOOL_PLAN_FIGURES.name } : undefined,
            jsonMode: provider === "openai",
          })
        );

        const parsed = extractJsonFromText(raw);
        if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).figures)) {
          plan = parsed as FigurePlan;
        } else if (Array.isArray(parsed)) {
          plan = { figures: parsed as PlannedFigure[] };
        } else {
          plan = { figures: [] };
        }
      } catch (e) {
        console.warn(`[generate_figures] LLM failed for section ${section.number}: ${e instanceof Error ? e.message : e}`);
        plan = { figures: [] };
      }

      // Validate and cap at 3
      const validFigures = (plan.figures || []).slice(0, 3).filter((f) => f.figureNumber && f.caption);

      for (const fig of validFigures) {
        // Validate blockId exists if specified
        if (fig.placement === "after_block_id" && fig.blockId && !blockIds.includes(fig.blockId)) {
          fig.placement = "even_spread";
          fig.blockId = undefined;
        }

        totalFigures++;

        // Ensure sequential figure number
        const expectedNum = `${chapterNum}.${totalFigures}`;
        fig.figureNumber = expectedNum;

        const figureSrc = `new_pipeline/assets/figures/${bookSlug}/Afbeelding_${fig.figureNumber}.png`;

        allPlannedFigures.push({
          sectionIdx: si,
          figure: fig,
          src: figureSrc,
        });
      }
    }

    console.log(`📊 LLM planned ${allPlannedFigures.length} figures for chapter ${chapterNum}`);

    // =========================================================================
    // Step 3: Generate placeholder PNGs
    // =========================================================================
    await emitJobEvent(job.id, job.book_id, "progress", 65, `Generating ${allPlannedFigures.length} placeholder PNGs`);

    const localFigureDir = path.resolve(repoRoot, "new_pipeline/assets/figures", bookSlug);
    fs.mkdirSync(localFigureDir, { recursive: true });

    for (const entry of allPlannedFigures) {
      const png = generatePlaceholderPng(entry.figure.figureNumber, entry.figure.caption);

      // Upload to Supabase Storage
      const storagePath = artifactPath(
        job.book_id, versionId,
        `assets/figures/Afbeelding_${entry.figure.figureNumber}.png`
      );
      await uploadFile(storagePath, png, "image/png");

      // Save locally
      const localPath = path.resolve(localFigureDir, `Afbeelding_${entry.figure.figureNumber}.png`);
      fs.writeFileSync(localPath, png);
    }

    // =========================================================================
    // Step 4: Inject figure blocks into canonical JSON
    // =========================================================================
    await emitJobEvent(job.id, job.book_id, "progress", 80, "Injecting figures into canonical JSON");

    // Group by section
    const bySection = new Map<number, typeof allPlannedFigures>();
    for (const entry of allPlannedFigures) {
      if (!bySection.has(entry.sectionIdx)) bySection.set(entry.sectionIdx, []);
      bySection.get(entry.sectionIdx)!.push(entry);
    }

    for (const [si, entries] of bySection) {
      const section = chapter.sections[si];
      injectFigureBlocks(
        section,
        entries.map((e) => ({
          figureNumber: e.figure.figureNumber,
          caption: e.figure.caption,
          src: e.src,
          blockId: e.figure.blockId,
        }))
      );
    }

    // =========================================================================
    // Step 5: Save updated canonical + figure manifest
    // =========================================================================
    await emitJobEvent(job.id, job.book_id, "progress", 90, "Saving updated canonical JSON");

    await uploadJson(chPath, chCanonical);

    // Save figure manifest for future AI image generation
    const manifest = {
      bookId: job.book_id,
      chapter: chapterNum,
      generatedAt: new Date().toISOString(),
      figures: allPlannedFigures.map((e) => ({
        figureNumber: e.figure.figureNumber,
        caption: e.figure.caption,
        description: e.figure.description,
        src: e.src,
        sectionNumber: chapter.sections[e.sectionIdx]?.number,
      })),
    };
    const manifestPath = artifactPath(job.book_id, versionId, `figure_manifest_ch${chapterNum}.json`);
    await uploadJson(manifestPath, manifest);

    // Also save manifest locally
    const localManifestPath = path.resolve(localFigureDir, `figure_manifest_ch${chapterNum}.json`);
    fs.writeFileSync(localManifestPath, JSON.stringify(manifest, null, 2));

    console.log(`✅ Chapter ${chapterNum}: ${allPlannedFigures.length} figures injected, opener generated`);

    return {
      ok: true,
      chapter: chapterNum,
      figuresPlanned: allPlannedFigures.length,
      openerPath: openerRelPath,
      manifestPath,
    };
  }
}

