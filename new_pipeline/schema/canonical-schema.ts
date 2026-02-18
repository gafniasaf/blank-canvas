/**
 * Canonical Book Schema
 * 
 * Renderer-agnostic content format for educational books.
 * This schema represents the source of truth for content,
 * independent of any rendering system (InDesign, HTML, PDF, etc.)
 * 
 * Key principles:
 * - No formatting markers (no <<BOLD_START>>, no \r)
 * - Semantic structure only
 * - All content is clean text
 * - Rendering decisions are made by templates, not content
 */

import type { StyleRole } from './style-roles';

// =============================================================================
// Core Types
// =============================================================================

export interface CanonicalBook {
  /** Book metadata */
  meta: BookMeta;
  /** Ordered list of chapters */
  chapters: CanonicalChapter[];
  /** Optional glossary for the entire book */
  glossary?: GlossaryTerm[];
  /** Export metadata */
  export: ExportMeta;
}

export interface BookMeta {
  /** Unique identifier (matches upload_id in database) */
  id: string;
  /** Book title */
  title: string;
  /** Education level: n3 (Verzorgende-IG) or n4 (Verpleegkundige) */
  level: 'n3' | 'n4';
  /** ISBN if available */
  isbn?: string;
  /** Publisher information */
  publisher?: string;
  /** Edition/version */
  edition?: string;
}

export interface ExportMeta {
  /** When this export was generated */
  exportedAt: string;
  /** Source system */
  source: 'supabase' | 'indesign' | 'manual';
  /** Schema version for forward compatibility */
  schemaVersion: '1.0';
}

// =============================================================================
// Chapter Structure
// =============================================================================

export interface CanonicalChapter {
  /** Chapter number as string (e.g., "1", "2", "10") */
  number: string;
  /** Chapter title */
  title: string;
  /** Ordered list of sections within the chapter */
  sections: CanonicalSection[];
  /** Chapter-level images (e.g., opener image) */
  images?: CanonicalImage[];
}

export interface CanonicalSection {
  /** Section number (e.g., "1.1", "2.3") */
  number: string;
  /** Section title (optional - some sections are just numbered) */
  title?: string;
  /** Ordered list of content blocks */
  content: ContentBlock[];
}

// =============================================================================
// Content Blocks
// =============================================================================

/**
 * A content block can be:
 * - A paragraph with optional praktijk/verdieping layers
 * - A subparagraph (e.g., 1.1.1)
 * - An image with caption
 * - A table
 */
export type ContentBlock = 
  | ParagraphBlock 
  | SubparagraphBlock 
  | ImageBlock 
  | TableBlock
  | ListBlock
  | StepsBlock;

export interface ParagraphBlock {
  type: 'paragraph';
  /** Unique identifier (matches database paragraph_id) */
  id: string;
  /** Original paragraph number from source (for reference) */
  paragraphNumber?: number;
  /** The main/basis text content */
  basis: string;
  /** "In de praktijk" layer - practical application (optional) */
  praktijk?: string;
  /** "Verdieping" layer - deeper explanation (optional) */
  verdieping?: string;
  /** Style hint from source (e.g., "•Basis", "•bullets") */
  styleHint?: string;
  /** Semantic style role derived from InDesign style names (stable rendering hook) */
  role?: StyleRole;
  /** Inline images anchored to this paragraph */
  images?: CanonicalImage[];
}

export interface SubparagraphBlock {
  type: 'subparagraph';
  /** Unique identifier */
  id: string;
  /** Subparagraph number (e.g., "1.1.1", "2.3.2") */
  number: string;
  /** Subparagraph title (optional) */
  title?: string;
  /** Content blocks within this subparagraph */
  content: ContentBlock[];
}

export interface ImageBlock {
  type: 'image';
  /** Unique identifier */
  id: string;
  /** Image file path or URL */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Caption text */
  caption?: string;
  /** Figure number (e.g., "Afbeelding 1.1") */
  figureNumber?: string;
  /** Image placement hint */
  placement?: 'inline' | 'float' | 'full-width';
}

export interface TableBlock {
  type: 'table';
  /** Unique identifier */
  id: string;
  /** Table caption */
  caption?: string;
  /** Table number (e.g., "Tabel 1.1") */
  tableNumber?: string;
  /** Header row */
  headers: string[];
  /** Data rows */
  rows: string[][];
}

export interface ListBlock {
  type: 'list';
  /** Unique identifier (matches database paragraph_id for anchored lists) */
  id: string;
  /** Ordered vs unordered list */
  ordered: boolean;
  /** Nesting level hint (1..3) */
  level: 1 | 2 | 3;
  /** List items as plain text */
  items: string[];
  /** Style hint from source */
  styleHint?: string;
  /** Semantic role */
  role?: StyleRole;
  /** Inline images anchored to this block */
  images?: CanonicalImage[];
}

export interface StepsBlock {
  type: 'steps';
  /** Unique identifier (matches database paragraph_id for anchored steps) */
  id: string;
  /** Ordered steps as plain text */
  items: string[];
  /** Style hint from source */
  styleHint?: string;
  /** Semantic role */
  role?: StyleRole;
  /** Inline images anchored to this block */
  images?: CanonicalImage[];
}

// =============================================================================
// Supporting Types
// =============================================================================

export interface CanonicalImage {
  /** Image file path or URL */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Caption text */
  caption?: string;
  /** Figure number */
  figureNumber?: string;
  /** Width hint (percentage or pixels) */
  width?: string;
}

export interface GlossaryTerm {
  /** The term being defined */
  term: string;
  /** Definition of the term */
  definition: string;
  /** Which chapter(s) this term appears in */
  chapters?: string[];
}

// =============================================================================
// Helper Types for Export
// =============================================================================

/**
 * Flattened paragraph for simpler iteration during rendering.
 * Includes full context (chapter, section, subparagraph info).
 */
export interface FlattenedParagraph {
  chapterNumber: string;
  chapterTitle: string;
  sectionNumber: string;
  sectionTitle?: string;
  subparagraphNumber?: string;
  paragraphId: string;
  paragraphNumber?: number;
  basis: string;
  praktijk?: string;
  verdieping?: string;
  styleHint?: string;
  images?: CanonicalImage[];
}

/**
 * Export options for generating canonical JSON
 */
export interface ExportOptions {
  /** Filter to specific chapter(s) */
  chapters?: string[];
  /** Include empty praktijk/verdieping fields */
  includeEmpty?: boolean;
  /** Include style hints from source */
  includeStyleHints?: boolean;
  /** Include images */
  includeImages?: boolean;
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validates that a CanonicalBook has required fields
 */
export function validateCanonicalBook(book: unknown): book is CanonicalBook {
  if (!book || typeof book !== 'object') return false;
  const b = book as Record<string, unknown>;
  
  if (!b.meta || typeof b.meta !== 'object') return false;
  if (!b.chapters || !Array.isArray(b.chapters)) return false;
  if (!b.export || typeof b.export !== 'object') return false;
  
  const meta = b.meta as Record<string, unknown>;
  if (typeof meta.id !== 'string') return false;
  if (typeof meta.title !== 'string') return false;
  if (meta.level !== 'n3' && meta.level !== 'n4') return false;
  
  return true;
}

/**
 * Counts total paragraphs in a book
 */
export function countParagraphs(book: CanonicalBook): number {
  let count = 0;
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      for (const block of section.content) {
        if (block.type === 'paragraph') {
          count++;
        } else if (block.type === 'subparagraph') {
          for (const inner of block.content) {
            if (inner.type === 'paragraph') count++;
          }
        }
      }
    }
  }
  return count;
}

/**
 * Counts paragraphs with praktijk/verdieping layers
 */
export function countLayers(book: CanonicalBook): { praktijk: number; verdieping: number } {
  let praktijk = 0;
  let verdieping = 0;
  
  function checkParagraph(p: ParagraphBlock) {
    if (p.praktijk && p.praktijk.trim().length > 0) praktijk++;
    if (p.verdieping && p.verdieping.trim().length > 0) verdieping++;
  }
  
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      for (const block of section.content) {
        if (block.type === 'paragraph') {
          checkParagraph(block);
        } else if (block.type === 'subparagraph') {
          for (const p of block.content) {
            checkParagraph(p);
          }
        }
      }
    }
  }
  
  return { praktijk, verdieping };
}

/**
 * Flattens a book into a list of paragraphs for simpler iteration
 */
export function flattenParagraphs(book: CanonicalBook): FlattenedParagraph[] {
  const result: FlattenedParagraph[] = [];
  
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      for (const block of section.content) {
        if (block.type === 'paragraph') {
          result.push({
            chapterNumber: chapter.number,
            chapterTitle: chapter.title,
            sectionNumber: section.number,
            sectionTitle: section.title,
            paragraphId: block.id,
            paragraphNumber: block.paragraphNumber,
            basis: block.basis,
            praktijk: block.praktijk,
            verdieping: block.verdieping,
            styleHint: block.styleHint,
            images: block.images,
          });
        } else if (block.type === 'subparagraph') {
          for (const p of block.content) {
            result.push({
              chapterNumber: chapter.number,
              chapterTitle: chapter.title,
              sectionNumber: section.number,
              sectionTitle: section.title,
              subparagraphNumber: block.number,
              paragraphId: p.id,
              paragraphNumber: p.paragraphNumber,
              basis: p.basis,
              praktijk: p.praktijk,
              verdieping: p.verdieping,
              styleHint: p.styleHint,
              images: p.images,
            });
          }
        }
      }
    }
  }
  
  return result;
}

