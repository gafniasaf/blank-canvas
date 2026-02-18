/**
 * Book Skeleton Schema (skeleton_v1)
 *
 * Ported from LearnPlay: queue-pump/src/bookSkeletonCore.ts
 * This is the authoring-side source of truth for content structure.
 * Pure TS — no Node/Deno imports.
 */

// =============================================================================
// Types
// =============================================================================

export type SkeletonSeverity = "error" | "warning";

export type SkeletonIssue = {
  severity: SkeletonSeverity;
  code: string;
  message: string;
  path: string[];
};

export type SkeletonMeta = {
  bookId: string;
  bookVersionId: string;
  title: string;
  level: "n3" | "n4";
  language: string;
  schemaVersion: "skeleton_v1";
  promptPackId?: string;
  promptPackVersion?: number;
};

export type SkeletonImage = {
  src: string;
  alt?: string | null;
  caption?: string | null;
  figureNumber?: string | null;
  layoutHint?: string | null;
  suggestedPrompt?: string | null;
};

export type SkeletonParagraphBlock = {
  type: "paragraph";
  id: string;
  basisHtml: string;
  praktijkHtml?: string | null;
  verdiepingHtml?: string | null;
  images?: SkeletonImage[] | null;
};

export type SkeletonListBlock = {
  type: "list";
  id: string;
  ordered?: boolean | null;
  items: string[];
  images?: SkeletonImage[] | null;
};

export type SkeletonStepsBlock = {
  type: "steps";
  id: string;
  items: string[];
  images?: SkeletonImage[] | null;
};

export type SkeletonSubparagraphBlock = {
  type: "subparagraph";
  id?: string | null;
  title: string;
  blocks: SkeletonBlock[];
};

export type SkeletonBlock =
  | SkeletonParagraphBlock
  | SkeletonListBlock
  | SkeletonStepsBlock
  | SkeletonSubparagraphBlock;

export type SkeletonSection = {
  id: string;
  title: string;
  blocks: SkeletonBlock[];
};

export type SkeletonChapterRecap = {
  objectives?: Array<{ text: string; sectionId?: string }>;
  glossary?: Array<{ term: string; definition: string; sectionId?: string }>;
  selfCheckQuestions?: Array<{ question: string; sectionId?: string }>;
};

export type SkeletonChapter = {
  title: string;
  chapterNumber: number;
  sections: SkeletonSection[];
  recap?: SkeletonChapterRecap | null;
};

export type BookSkeletonV1 = {
  meta: SkeletonMeta;
  chapters: SkeletonChapter[];
};

// =============================================================================
// Validation
// =============================================================================

export function validateBookSkeleton(raw: unknown): {
  ok: boolean;
  skeleton: BookSkeletonV1;
  issues: SkeletonIssue[];
} {
  const issues: SkeletonIssue[] = [];

  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      skeleton: raw as BookSkeletonV1,
      issues: [{ severity: "error", code: "INVALID_ROOT", message: "Skeleton must be an object", path: [] }],
    };
  }

  const sk = raw as Record<string, unknown>;

  // Meta validation
  const meta = sk.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== "object") {
    issues.push({ severity: "error", code: "MISSING_META", message: "Missing meta object", path: ["meta"] });
  } else {
    if (typeof meta.bookId !== "string" || !meta.bookId) {
      issues.push({ severity: "error", code: "MISSING_BOOK_ID", message: "meta.bookId is required", path: ["meta", "bookId"] });
    }
    if (typeof meta.title !== "string" || !meta.title) {
      issues.push({ severity: "error", code: "MISSING_TITLE", message: "meta.title is required", path: ["meta", "title"] });
    }
    if (meta.level !== "n3" && meta.level !== "n4") {
      issues.push({ severity: "error", code: "INVALID_LEVEL", message: "meta.level must be 'n3' or 'n4'", path: ["meta", "level"] });
    }
    if (meta.schemaVersion !== "skeleton_v1") {
      issues.push({ severity: "warning", code: "SCHEMA_VERSION", message: `Expected skeleton_v1, got ${meta.schemaVersion}`, path: ["meta", "schemaVersion"] });
    }
  }

  // Chapters validation
  const chapters = Array.isArray(sk.chapters) ? sk.chapters : [];
  if (chapters.length === 0) {
    issues.push({ severity: "error", code: "NO_CHAPTERS", message: "Skeleton has no chapters", path: ["chapters"] });
  }

  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci] as Record<string, unknown>;
    const chPath = ["chapters", String(ci)];

    if (typeof ch.title !== "string" || !ch.title) {
      issues.push({ severity: "error", code: "CHAPTER_NO_TITLE", message: `Chapter ${ci} has no title`, path: [...chPath, "title"] });
    }

    const sections = Array.isArray(ch.sections) ? ch.sections : [];
    if (sections.length === 0) {
      issues.push({ severity: "warning", code: "CHAPTER_NO_SECTIONS", message: `Chapter ${ci} has no sections`, path: [...chPath, "sections"] });
    }

    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si] as Record<string, unknown>;
      const secPath = [...chPath, "sections", String(si)];

      if (typeof sec.id !== "string" || !sec.id) {
        issues.push({ severity: "error", code: "SECTION_NO_ID", message: `Section ${si} in chapter ${ci} has no id`, path: [...secPath, "id"] });
      }
      if (typeof sec.title !== "string" || !sec.title) {
        issues.push({ severity: "error", code: "SECTION_NO_TITLE", message: `Section ${si} in chapter ${ci} has no title`, path: [...secPath, "title"] });
      }

      const blocks = Array.isArray(sec.blocks) ? sec.blocks : [];
      validateBlocks(blocks, [...secPath, "blocks"], issues);
    }
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  return { ok: !hasErrors, skeleton: raw as BookSkeletonV1, issues };
}

function validateBlocks(blocks: unknown[], basePath: string[], issues: SkeletonIssue[]): void {
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi] as Record<string, unknown>;
    const bPath = [...basePath, String(bi)];
    const bType = typeof block?.type === "string" ? block.type : "";

    switch (bType) {
      case "paragraph": {
        if (typeof block.id !== "string" || !block.id) {
          issues.push({ severity: "error", code: "PARA_NO_ID", message: "Paragraph block missing id", path: [...bPath, "id"] });
        }
        if (typeof block.basisHtml !== "string") {
          issues.push({ severity: "error", code: "PARA_NO_BASIS", message: "Paragraph block missing basisHtml", path: [...bPath, "basisHtml"] });
        }
        break;
      }
      case "list":
      case "steps": {
        if (typeof block.id !== "string" || !block.id) {
          issues.push({ severity: "error", code: "LIST_NO_ID", message: `${bType} block missing id`, path: [...bPath, "id"] });
        }
        if (!Array.isArray(block.items)) {
          issues.push({ severity: "error", code: "LIST_NO_ITEMS", message: `${bType} block missing items[]`, path: [...bPath, "items"] });
        }
        break;
      }
      case "subparagraph": {
        if (typeof block.title !== "string" || !block.title) {
          issues.push({ severity: "error", code: "SUBPARA_NO_TITLE", message: "Subparagraph missing title", path: [...bPath, "title"] });
        }
        const subBlocks = Array.isArray(block.blocks) ? block.blocks : [];
        validateBlocks(subBlocks, [...bPath, "blocks"], issues);
        break;
      }
      default:
        issues.push({ severity: "warning", code: "UNKNOWN_BLOCK_TYPE", message: `Unknown block type: ${bType}`, path: bPath });
    }
  }
}

