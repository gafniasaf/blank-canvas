/**
 * build-embedded-figures-map.ts
 *
 * Build a paragraphId -> images[] mapping from "embedded_figures" PNGs exported from InDesign.
 *
 * This is a pragmatic bridge until we have a deterministic figure manifest -> paragraph-id pipeline
 * for every book. For now we map by section number encoded in the exported filename:
 *
 *   Persoonlijke_verzorging_Hoofdstuk12_12.2_Het_wattenstaafje..._grouped.png
 *                      ^chapter      ^section number
 *
 * We attach each image to the FIRST "attachable" content block inside that section
 * (paragraph/list/steps, or the first such block inside the first subparagraph).
 *
 * Output format matches `scripts/apply-figures-mapping.ts`.
 *
 * Usage:
 *   npx tsx scripts/build-embedded-figures-map.ts \
 *     --book-json /abs/path/to/book.json \
 *     --embedded-dir /abs/path/to/extracted_images/<book>/embedded_figures \
 *     --out /abs/path/to/out_figures_by_paragraph.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type CanonicalImage = {
  src: string;
  alt: string;
  figureNumber?: string;
  caption?: string;
  placement?: 'inline' | 'float' | 'full-width';
  width?: string;
};

type FiguresByParagraph = Record<string, CanonicalImage[]>;

type CanonicalBook = {
  meta?: { title?: string };
  chapters: Array<{
    number: string;
    title?: string;
    sections: Array<{
      number: string;
      title?: string;
      content: any[];
    }>;
  }>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return String(v);
}

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function toRepoRel(absPath: string): string {
  const abs = path.resolve(absPath);
  const rel = path.relative(REPO_ROOT, abs);
  if (!rel.startsWith('..')) return rel.replace(/\\/g, '/');
  return abs.replace(/\\/g, '/');
}

function normalizeAltFromFilename(fileBase: string): string {
  // Drop extension + "_grouped" suffix, then underscores -> spaces.
  let s = String(fileBase || '');
  s = s.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '');
  s = s.replace(/_grouped(?:_\d+)?$/i, '');
  s = s.replace(/_+/g, ' ');
  s = s.trim();
  return s || 'Figuur';
}

function findFirstAttachableId(blocks: any[]): string | null {
  const arr = Array.isArray(blocks) ? blocks : [];
  for (const b of arr) {
    if (!b || typeof b !== 'object') continue;
    const t = String((b as any).type || '');
    const id = (b as any).id ? String((b as any).id) : null;

    if ((t === 'paragraph' || t === 'list' || t === 'steps') && id) return id;

    // canonical subparagraph wrapper
    if (t === 'subparagraph' && Array.isArray((b as any).content)) {
      const inner = findFirstAttachableId((b as any).content);
      if (inner) return inner;
    }

    // generic recursive fallback
    if (Array.isArray((b as any).content)) {
      const inner = findFirstAttachableId((b as any).content);
      if (inner) return inner;
    }
  }
  return null;
}

function findFirstAttachableIdBySubparagraphTitle(book: CanonicalBook, needle: RegExp): string | null {
  for (const ch of book.chapters || []) {
    for (const sec of ch.sections || []) {
      const walk = (blocks: any[]): string | null => {
        const arr = Array.isArray(blocks) ? blocks : [];
        for (const b of arr) {
          if (!b || typeof b !== 'object') continue;
          if (String((b as any).type || '') === 'subparagraph') {
            const title = String((b as any).title || '').trim();
            if (title && needle.test(title)) {
              const attach = findFirstAttachableId((b as any).content || []);
              if (attach) return attach;
            }
            const inner = walk((b as any).content || []);
            if (inner) return inner;
          } else if (Array.isArray((b as any).content)) {
            const inner = walk((b as any).content);
            if (inner) return inner;
          }
        }
        return null;
      };
      const got = walk(sec.content || []);
      if (got) return got;
    }
  }
  return null;
}

function parseSectionNumberFromFilename(fileBase: string): { chapter: string; section: string } | null {
  const s = String(fileBase || '');
  // Examples:
  // - Persoonlijke_verzorging_Hoofdstuk12_12.2_...
  // - Persoonlijke_verzorging_Hoofdstuk_21_21.2_...
  const m = s.match(/Hoofdstuk_?(\d+)_((?:\d+\.)+\d+)/i);
  if (!m) return null;
  return { chapter: String(m[1]), section: String(m[2]) };
}

async function main() {
  const bookJson = getArg('--book-json');
  const embeddedDir = getArg('--embedded-dir');
  const out = getArg('--out');

  if (!bookJson || !embeddedDir || !out) {
    die(
      'Usage: npx tsx scripts/build-embedded-figures-map.ts --book-json <book.json> --embedded-dir <dir> --out <out.json>'
    );
  }

  const bookPath = path.resolve(bookJson);
  if (!fs.existsSync(bookPath)) die(`Book JSON not found: ${bookPath}`);
  const embedPath = path.resolve(embeddedDir);
  if (!fs.existsSync(embedPath) || !fs.statSync(embedPath).isDirectory()) die(`embedded-dir not found: ${embedPath}`);

  const book = JSON.parse(fs.readFileSync(bookPath, 'utf8')) as CanonicalBook;
  if (!book.chapters || book.chapters.length === 0) die('Book JSON has no chapters');

  // Build sectionNumber -> paragraphId index.
  const sectionToAttachId = new Map<string, string>();
  for (const ch of book.chapters) {
    for (const sec of ch.sections || []) {
      const attach = findFirstAttachableId(sec.content || []);
      if (attach) sectionToAttachId.set(String(sec.number), attach);
    }
  }

  const files = fs
    .readdirSync(embedPath)
    .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const mapping: FiguresByParagraph = {};
  const unmapped: Array<{ file: string; reason: string }> = [];
  let mappedCount = 0;

  // Special-case fallback (common PV figure)
  const decubitusAttachId =
    findFirstAttachableIdBySubparagraphTitle(book, /\bdecubitus\b/i) ||
    findFirstAttachableIdBySubparagraphTitle(book, /\bdoorlig\w*\b/i);

  for (const f of files) {
    const abs = path.resolve(embedPath, f);
    const rel = toRepoRel(abs);
    const alt = normalizeAltFromFilename(f);

    const parsed = parseSectionNumberFromFilename(f);
    if (parsed) {
      const attachId = sectionToAttachId.get(parsed.section) || null;
      if (!attachId) {
        unmapped.push({ file: f, reason: `No section ${parsed.section} in book JSON (chapter hint ${parsed.chapter})` });
        continue;
      }
      if (!mapping[attachId]) mapping[attachId] = [];
      mapping[attachId].push({ src: rel, alt });
      mappedCount++;
      continue;
    }

    // Heuristic: attach decubitus hotspot image to the Decubitus subparagraph.
    if (/decubitus/i.test(f) && decubitusAttachId) {
      if (!mapping[decubitusAttachId]) mapping[decubitusAttachId] = [];
      mapping[decubitusAttachId].push({ src: rel, alt });
      mappedCount++;
      continue;
    }

    unmapped.push({ file: f, reason: 'Filename does not include a recognizable section number' });
  }

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(path.resolve(out), JSON.stringify(mapping, null, 2), 'utf8');

  console.log(`✅ Built embedded-figures mapping`);
  console.log(`   book: ${book.meta?.title || '(no title in JSON)'}`);
  console.log(`   embedded-dir: ${embedPath}`);
  console.log(`   images found: ${files.length}`);
  console.log(`   images mapped: ${mappedCount}`);
  console.log(`   paragraphs with images: ${Object.keys(mapping).length}`);
  console.log(`   out: ${path.resolve(out)}`);

  if (unmapped.length) {
    console.log(`⚠️  Unmapped images: ${unmapped.length}`);
    for (const u of unmapped.slice(0, 50)) {
      console.log(`   - ${u.file}: ${u.reason}`);
    }
    if (unmapped.length > 50) console.log(`   ... ${unmapped.length - 50} more`);
  }
}

main().catch((err) => {
  console.error('❌ build-embedded-figures-map failed:', err?.stack || err?.message || String(err));
  process.exit(1);
});


