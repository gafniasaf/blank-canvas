/**
 * Verify figure integrity in a canonical JSON export.
 *
 * Hard fails on:
 * - Missing src files on disk
 * - Missing figureNumber or caption for any paragraph-attached figure
 * - Duplicate figureNumber within the JSON
 *
 * Usage:
 *   npx tsx new_pipeline/validate/verify-figures.ts <canonical.json>
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname shim
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type CanonicalImage = {
  src: string;
  alt: string;
  caption?: string;
  figureNumber?: string;
  width?: string;
};

type ParagraphBlock = {
  type: 'paragraph';
  id: string;
  basis: string;
  images?: CanonicalImage[];
};

type ListBlock = {
  type: 'list';
  id: string;
  items: string[];
  images?: CanonicalImage[];
};

type StepsBlock = {
  type: 'steps';
  id: string;
  items: string[];
  images?: CanonicalImage[];
};

type SubparagraphBlock = {
  type: 'subparagraph';
  id: string;
  number: string;
  content: Array<ParagraphBlock | ListBlock | StepsBlock>;
};

type ContentBlock = ParagraphBlock | ListBlock | StepsBlock | SubparagraphBlock | any;

type CanonicalBook = {
  chapters: Array<{
    number: string;
    title: string;
    images?: CanonicalImage[];
    sections: Array<{
      number: string;
      title?: string;
      content: ContentBlock[];
    }>;
  }>;
};

function die(msg: string): never {
  console.error(`VERIFICATION FAILED: ${msg}`);
  process.exit(1);
}

function repoRootFromThisFile(): string {
  // new_pipeline/validate -> new_pipeline -> repo root
  return path.resolve(__dirname, '../..');
}

function ensureFileExists(repoRoot: string, relPath: string): void {
  const abs = path.resolve(repoRoot, relPath);
  if (!fs.existsSync(abs)) {
    die(`Missing image file on disk: ${relPath} (abs=${abs})`);
  }
}

function main() {
  const input = process.argv[2];
  if (!input) {
    die('Usage: npx tsx new_pipeline/validate/verify-figures.ts <canonical.json>');
  }

  const repoRoot = repoRootFromThisFile();
  const jsonPath = path.resolve(input);
  if (!fs.existsSync(jsonPath)) die(`Input JSON not found: ${jsonPath}`);

  const book = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as CanonicalBook;
  if (!book.chapters || book.chapters.length === 0) die('No chapters in canonical JSON');

  const figureNumbers = new Map<string, string>(); // figureNumber -> paragraphId
  let figureCount = 0;

  for (const ch of book.chapters) {
    // Chapter-level images (opener) must exist, but don't require figureNumber/caption
    for (const img of ch.images || []) {
      if (!img.src) die(`Chapter image missing src (chapter ${ch.number})`);
      ensureFileExists(repoRoot, img.src);
    }

    for (const sec of ch.sections) {
      for (const block of sec.content) {
        const figHolders: Array<ParagraphBlock | ListBlock | StepsBlock> =
          block.type === 'paragraph' || block.type === 'list' || block.type === 'steps'
            ? [block as any]
            : block.type === 'subparagraph'
              ? (block as SubparagraphBlock).content
              : [];

        for (const p of figHolders) {
          for (const img of (p.images || [])) {
            figureCount++;
            if (!img.src) die(`Paragraph ${p.id} has figure missing src`);
            ensureFileExists(repoRoot, img.src);

            if (!img.figureNumber || !img.figureNumber.trim()) {
              die(`Paragraph ${p.id} has figure missing figureNumber`);
            }
            if (!img.figureNumber.trim().endsWith(':')) {
              die(`FigureNumber must end with ':' (${img.figureNumber})`);
            }
            if (!img.caption || !img.caption.trim()) {
              die(`Paragraph ${p.id} has figure missing caption`);
            }

            const fn = img.figureNumber.trim();
            if (figureNumbers.has(fn)) {
              die(`Duplicate figureNumber ${fn} (paragraphs: ${figureNumbers.get(fn)} and ${p.id})`);
            }
            figureNumbers.set(fn, p.id);
          }
        }
      }
    }
  }

  console.log(`✅ Figure verification passed`);
  console.log(`   Figures found: ${figureCount}`);
  console.log(`   Unique figure numbers: ${figureNumbers.size}`);
}

main();


