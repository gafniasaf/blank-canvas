/**
 * Canonical Book Schema
 *
 * Ported from TestRun: new_pipeline/schema/canonical-schema.ts
 * Renderer-agnostic content format — the Prince renderer consumes this.
 *
 * Key principles:
 * - No formatting markers in the schema (<<BOLD_START>> etc. are replaced by inline HTML)
 * - Semantic structure only
 * - Rendering decisions are made by templates, not content
 */

// =============================================================================
// Core Types
// =============================================================================

export interface CanonicalBook {
  meta: BookMeta;
  chapters: CanonicalChapter[];
  glossary?: GlossaryTerm[];
  index?: IndexEntry[];
  export: ExportMeta;
}

export interface BookMeta {
  id: string;
  title: string;
  level: "n3" | "n4";
  isbn?: string;
  publisher?: string;
  edition?: string;
}

export interface ExportMeta {
  exportedAt: string;
  source: "supabase" | "indesign" | "manual" | "bookgen";
  schemaVersion: "1.0";
}

// =============================================================================
// Chapter Structure
// =============================================================================

export interface CanonicalChapter {
  number: string;
  title: string;
  sections: CanonicalSection[];
  images?: CanonicalImage[];
  recap?: ChapterRecap;
}

export interface ChapterRecap {
  objectives?: Array<{ text: string; sectionId?: string }>;
  glossary?: Array<{ term: string; definition: string; sectionId?: string }>;
  selfCheckQuestions?: Array<{ question: string; sectionId?: string }>;
}

export interface CanonicalSection {
  number: string;
  title?: string;
  content: ContentBlock[];
}

// =============================================================================
// Content Blocks
// =============================================================================

export type ContentBlock =
  | ParagraphBlock
  | SubparagraphBlock
  | ImageBlock
  | TableBlock
  | ListBlock
  | StepsBlock;

export interface ParagraphBlock {
  type: "paragraph";
  id: string;
  paragraphNumber?: number;
  basis: string;
  praktijk?: string;
  verdieping?: string;
  styleHint?: string;
  role?: string;
  images?: CanonicalImage[];
}

export interface SubparagraphBlock {
  type: "subparagraph";
  id: string;
  number: string;
  title?: string;
  content: ContentBlock[];
}

export interface ImageBlock {
  type: "image";
  id: string;
  src: string;
  alt: string;
  caption?: string;
  figureNumber?: string;
  placement?: "inline" | "float" | "full-width";
}

export interface TableBlock {
  type: "table";
  id: string;
  caption?: string;
  tableNumber?: string;
  headers: string[];
  rows: string[][];
}

export interface ListBlock {
  type: "list";
  id: string;
  ordered: boolean;
  level: 1 | 2 | 3;
  items: string[];
  styleHint?: string;
  role?: string;
  images?: CanonicalImage[];
}

export interface StepsBlock {
  type: "steps";
  id: string;
  items: string[];
  styleHint?: string;
  role?: string;
  images?: CanonicalImage[];
}

// =============================================================================
// Supporting Types
// =============================================================================

export interface CanonicalImage {
  src: string;
  alt: string;
  caption?: string;
  figureNumber?: string;
  width?: string;
}

export interface GlossaryTerm {
  term: string;
  latin?: string;
  definition: string;
  chapters?: string[];
}

export interface IndexEntry {
  term: string;
  variants?: string[];
  seeAlso?: string[];
}

// =============================================================================
// Compile: skeleton_v1 -> CanonicalBook
// =============================================================================

import type { BookSkeletonV1, SkeletonBlock, SkeletonChapter } from "./skeleton.js";

/**
 * Deterministic compilation from skeleton_v1 to CanonicalBook format.
 * One-way transformation (skeleton is the authoring source of truth).
 */
export function compileSkeletonToCanonical(skeleton: BookSkeletonV1): CanonicalBook {
  const meta: BookMeta = {
    id: skeleton.meta.bookId,
    title: skeleton.meta.title,
    level: skeleton.meta.level,
  };

  const chapters: CanonicalChapter[] = skeleton.chapters.map((ch) =>
    compileChapter(ch)
  );

  return {
    meta,
    chapters,
    export: {
      exportedAt: new Date().toISOString(),
      source: "bookgen",
      schemaVersion: "1.0",
    },
  };
}

function compileChapter(ch: SkeletonChapter): CanonicalChapter {
  const sections: CanonicalSection[] = ch.sections.map((sec) => ({
    number: sec.id,
    title: sec.title,
    content: compileBlocks(sec.blocks),
  }));

  const canonical: CanonicalChapter = {
    number: String(ch.chapterNumber),
    title: ch.title,
    sections,
  };

  if (ch.recap) {
    canonical.recap = {
      objectives: ch.recap.objectives,
      glossary: ch.recap.glossary,
      selfCheckQuestions: ch.recap.selfCheckQuestions,
    };
  }

  return canonical;
}

function compileBlocks(blocks: SkeletonBlock[] | undefined | null): ContentBlock[] {
  if (!blocks || !Array.isArray(blocks)) return [];
  const out: ContentBlock[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "paragraph": {
        const p: ParagraphBlock = {
          type: "paragraph",
          id: block.id,
          basis: block.basisHtml,
        };
        if (block.praktijkHtml) p.praktijk = block.praktijkHtml;
        if (block.verdiepingHtml) p.verdieping = block.verdiepingHtml;
        if (block.images?.length) {
          p.images = block.images.map((img) => ({
            src: img.src,
            alt: img.alt ?? "",
            caption: img.caption ?? undefined,
            figureNumber: img.figureNumber ?? undefined,
          }));
        }
        out.push(p);
        break;
      }
      case "list": {
        const l: ListBlock = {
          type: "list",
          id: block.id,
          ordered: block.ordered ?? false,
          level: 1,
          items: block.items,
        };
        if (block.images?.length) {
          l.images = block.images.map((img) => ({
            src: img.src,
            alt: img.alt ?? "",
            caption: img.caption ?? undefined,
            figureNumber: img.figureNumber ?? undefined,
          }));
        }
        out.push(l);
        break;
      }
      case "steps": {
        const s: StepsBlock = {
          type: "steps",
          id: block.id,
          items: block.items,
        };
        if (block.images?.length) {
          s.images = block.images.map((img) => ({
            src: img.src,
            alt: img.alt ?? "",
            caption: img.caption ?? undefined,
            figureNumber: img.figureNumber ?? undefined,
          }));
        }
        out.push(s);
        break;
      }
      case "subparagraph": {
        const sub: SubparagraphBlock = {
          type: "subparagraph",
          id: block.id ?? `sub-${block.title}`,
          number: block.id ?? "",
          title: block.title,
          content: compileBlocks(Array.isArray(block.blocks) ? block.blocks : []),
        };
        out.push(sub);
        break;
      }
    }
  }

  return out;
}

