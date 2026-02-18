/**
 * inject_existing_figures strategy
 *
 * Injects pre-existing figures from an external manifest (e.g. InDesign-extracted)
 * into the assembled canonical chapter JSON.  No LLM calls or image generation —
 * purely a mapping/injection step that spreads figures evenly across sections.
 *
 * Input:
 *   - assembled chapter canonical JSON  (from assemble_chapter)
 *   - figure manifest in Supabase Storage  (af4_figure_manifest.json)
 * Output:
 *   - updated canonical JSON with type:'image' blocks injected
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson, artifactPath } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import type {
  CanonicalBook,
  CanonicalSection,
  ContentBlock,
  ImageBlock,
} from "../schema/canonical.js";

// =============================================================================
// Types
// =============================================================================

interface ManifestFigure {
  chapter: number;
  figureNumber: string; // e.g. "Afbeelding 1.1:"
  src: string; // e.g. "new_pipeline/assets/figures/af4/Afbeelding_1.1.png"
  caption?: string;
}

interface FigureManifest {
  figures: ManifestFigure[];
}

// =============================================================================
// Helpers
// =============================================================================

/** Extract the numeric key (e.g. "3.12") from a figure number string. */
function figNumKey(raw: string): string {
  return raw
    .replace(/^(Afbeelding|Figuur)\s*/i, "")
    .replace(/:$/, "")
    .trim();
}

/**
 * Distribute `items` as evenly as possible across `bucketCount` buckets.
 * Returns an array of length `bucketCount`, each element an array of items.
 */
function distribute<T>(items: T[], bucketCount: number): T[][] {
  if (bucketCount <= 0) return [items];
  const buckets: T[][] = Array.from({ length: bucketCount }, () => []);
  for (let i = 0; i < items.length; i++) {
    buckets[i % bucketCount].push(items[i]);
  }
  return buckets;
}

// =============================================================================
// Strategy
// =============================================================================

export default class InjectExistingFigures implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const versionId = job.input_artifacts.book_version_id || "v1";
    const chapterNum = job.chapter;
    if (chapterNum == null) throw new Error("BLOCKED: chapter is required for inject_existing_figures");

    const bookSlug = job.input_artifacts.book_slug || "af4";

    await emitJobEvent(job.id, job.book_id, "progress", 5, `Loading chapter ${chapterNum}`);

    // ─── 1. Load chapter canonical JSON ────────────────────────────────
    const chPath = artifactPath(job.book_id, versionId, `canonical_ch${chapterNum}.json`);
    const chCanonical = await downloadJson<CanonicalBook>(chPath);
    const chapter = chCanonical.chapters?.[0];
    if (!chapter) throw new Error(`BLOCKED: No chapter found in canonical for ch${chapterNum}`);

    // ─── 2. Load figure manifest ───────────────────────────────────────
    await emitJobEvent(job.id, job.book_id, "progress", 15, "Loading figure manifest");

    const manifestStoragePath = job.input_artifacts.figure_manifest
      || artifactPath(job.book_id, versionId, "af4_figure_manifest.json");

    let manifest: FigureManifest;
    try {
      manifest = await downloadJson<FigureManifest>(manifestStoragePath);
    } catch (e) {
      console.warn(`[inject_existing_figures] No manifest found: ${e instanceof Error ? e.message : e}`);
      return { ok: true, chapter: chapterNum, skipped: true, reason: "no manifest" };
    }

    // ─── 3. Filter figures for this chapter ────────────────────────────
    const chapterFigures = (manifest.figures || []).filter(
      (f) => f.chapter === chapterNum
    );

    if (chapterFigures.length === 0) {
      console.log(`[inject_existing_figures] No figures for chapter ${chapterNum}`);
      await uploadJson(chPath, chCanonical); // re-save unchanged
      return { ok: true, chapter: chapterNum, figuresInjected: 0 };
    }

    await emitJobEvent(
      job.id, job.book_id, "progress", 40,
      `Injecting ${chapterFigures.length} figures into ${chapter.sections.length} sections`
    );

    // ─── 4. Distribute figures across sections ─────────────────────────
    // Sort figures by their number (1.1, 1.2, ..., 1.16)
    chapterFigures.sort((a, b) => {
      const aKey = figNumKey(a.figureNumber);
      const bKey = figNumKey(b.figureNumber);
      const aParts = aKey.split(".").map(Number);
      const bParts = bKey.split(".").map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const diff = (aParts[i] || 0) - (bParts[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });

    const sections = chapter.sections;
    const buckets = distribute(chapterFigures, sections.length);

    let injected = 0;

    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      const sectionFigures = buckets[si];
      if (!sectionFigures || sectionFigures.length === 0) continue;

      // Inject each figure as an ImageBlock at evenly-spaced positions in the section
      const blocks = section.content || [];
      const insertablePositions: number[] = [];

      // Find positions after paragraph/subparagraph blocks (not after lists/images)
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (b.type === "paragraph" || b.type === "subparagraph") {
          insertablePositions.push(bi + 1);
        }
      }

      // If no good positions, just append at end
      if (insertablePositions.length === 0) {
        insertablePositions.push(blocks.length);
      }

      // Spread figures across available positions
      for (let fi = 0; fi < sectionFigures.length; fi++) {
        const fig = sectionFigures[fi];
        const key = figNumKey(fig.figureNumber);

        const imageBlock: ImageBlock = {
          type: "image",
          id: `fig_${key.replace(/\./g, "_")}`,
          src: fig.src,
          alt: fig.caption || `Afbeelding ${key}`,
          caption: fig.caption || undefined,
          figureNumber: `Afbeelding ${key}:`,
          placement: "full-width",
        };

        // Pick insertion position
        const posIdx = Math.min(
          fi,
          insertablePositions.length - 1
        );
        const insertAt = insertablePositions[posIdx] + fi; // shift by already-inserted count
        section.content.splice(insertAt, 0, imageBlock as ContentBlock);
        injected++;
      }
    }

    // ─── 5. Save updated canonical ─────────────────────────────────────
    await emitJobEvent(job.id, job.book_id, "progress", 85, "Saving updated canonical");
    await uploadJson(chPath, chCanonical);

    console.log(`✅ Ch ${chapterNum}: ${injected} existing figures injected across ${sections.length} sections`);

    return {
      ok: true,
      chapter: chapterNum,
      figuresInjected: injected,
      bookSlug,
    };
  }
}

