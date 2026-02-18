/**
 * extract_skeleton strategy
 *
 * Converts a canonical JSON chapter into a skeleton_v1 structure.
 * Ported from TestRun: new_pipeline/scripts/extract-skeleton.ts
 *
 * Input:  canonical chapter JSON (from Supabase Storage)
 * Output: skeleton_v1 JSON (saved to Supabase Storage)
 */

import type { JobContext, JobExecutor, StrategyResult } from "./types.js";
import { downloadJson, uploadJson, artifactPath } from "../storage.js";
import { emitJobEvent } from "../job-events.js";
import type { CanonicalBook, CanonicalSection, ContentBlock, SubparagraphBlock, ParagraphBlock } from "../schema/canonical.js";
import type { BookSkeletonV1, SkeletonBlock, SkeletonSection, SkeletonChapter, SkeletonParagraphBlock } from "../schema/skeleton.js";

function stripInlineMarkers(text: string): string {
  return text
    .replace(/<<BOLD_START>>/g, "<strong>")
    .replace(/<<BOLD_END>>/g, "</strong>")
    .replace(/<<MICRO_TITLE>>/g, "")
    .replace(/<<MICRO_TITLE_END>>/g, "")
    .trim();
}

function convertBlockToSkeleton(block: ContentBlock, sectionId: string, idx: number): SkeletonBlock | null {
  switch (block.type) {
    case "paragraph": {
      const p = block as ParagraphBlock;
      const basis = stripInlineMarkers(p.basis || "");
      if (!basis) return null;

      const result: SkeletonParagraphBlock = {
        type: "paragraph",
        id: p.id || `${sectionId}_p${idx}`,
        basisHtml: basis,
      };
      if (p.praktijk) result.praktijkHtml = stripInlineMarkers(p.praktijk);
      if (p.verdieping) result.verdiepingHtml = stripInlineMarkers(p.verdieping);
      if (p.images?.length) {
        result.images = p.images.map((img) => ({
          src: img.src,
          alt: img.alt,
          caption: img.caption ?? null,
          figureNumber: img.figureNumber ?? null,
        }));
      }
      return result;
    }
    case "list": {
      if (!block.items?.length) return null;
      return {
        type: "list",
        id: block.id || `${sectionId}_l${idx}`,
        ordered: block.ordered ?? false,
        items: block.items.map(stripInlineMarkers),
      };
    }
    case "steps": {
      if (!block.items?.length) return null;
      return {
        type: "steps",
        id: block.id || `${sectionId}_s${idx}`,
        items: block.items.map(stripInlineMarkers),
      };
    }
    case "subparagraph": {
      const sub = block as SubparagraphBlock;
      const innerBlocks: SkeletonBlock[] = [];
      for (let i = 0; i < sub.content.length; i++) {
        const inner = convertBlockToSkeleton(sub.content[i]!, sub.number || sectionId, i);
        if (inner) innerBlocks.push(inner);
      }
      if (!innerBlocks.length) return null;
      return {
        type: "subparagraph",
        id: sub.number || sub.id || null,
        title: sub.title ?? `${sub.number}`,
        blocks: innerBlocks,
      };
    }
    default:
      return null;
  }
}

function extractSectionSkeleton(section: CanonicalSection): SkeletonSection {
  const blocks: SkeletonBlock[] = [];
  for (let i = 0; i < section.content.length; i++) {
    const b = convertBlockToSkeleton(section.content[i]!, section.number, i);
    if (b) blocks.push(b);
  }
  return {
    id: section.number,
    title: section.title ?? section.number,
    blocks,
  };
}

export default class ExtractSkeleton implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    const chapter = job.chapter;
    if (chapter == null) throw new Error("BLOCKED: chapter is required for extract_skeleton");

    const canonicalPath = job.input_artifacts.canonical_json;
    if (!canonicalPath) throw new Error("BLOCKED: input_artifacts.canonical_json is required");

    await emitJobEvent(job.id, job.book_id, "progress", 10, "Loading canonical JSON");
    const canonical = await downloadJson<CanonicalBook>(canonicalPath);

    const chapterData = canonical.chapters.find((ch) => String(ch.number) === String(chapter));
    if (!chapterData) throw new Error(`BLOCKED: Chapter ${chapter} not found in canonical`);

    await emitJobEvent(job.id, job.book_id, "progress", 40, "Extracting skeleton");

    const sections: SkeletonSection[] = chapterData.sections.map(extractSectionSkeleton);

    const skeletonChapter: SkeletonChapter = {
      title: chapterData.title,
      chapterNumber: Number(chapterData.number),
      sections,
    };

    const skeleton: BookSkeletonV1 = {
      meta: {
        bookId: job.book_id,
        bookVersionId: job.input_artifacts.book_version_id || "v1",
        title: canonical.meta.title,
        level: canonical.meta.level,
        language: "nl",
        schemaVersion: "skeleton_v1",
      },
      chapters: [skeletonChapter],
    };

    const outPath = artifactPath(job.book_id, skeleton.meta.bookVersionId, `skeleton_ch${chapter}.json`);
    await emitJobEvent(job.id, job.book_id, "progress", 80, "Uploading skeleton");
    await uploadJson(outPath, skeleton);

    return { ok: true, outPath, sections: sections.length };
  }
}

