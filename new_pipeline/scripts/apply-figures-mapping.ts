/**
 * Apply a figures-by-paragraph mapping to an existing canonical book JSON.
 *
 * Why:
 * - Some canonical JSONs (or rewrite-assembled JSONs) may be missing the `images` arrays.
 * - We already have deterministic mappings in `new_pipeline/extract/figures_by_paragraph_all.json`
 *   (keyed by paragraph UUID).
 *
 * Usage:
 *   npx tsx new_pipeline/scripts/apply-figures-mapping.ts <in_book.json> <figures_by_paragraph.json> <out_book.json>
 */

import * as fs from 'fs';
import * as path from 'path';

type FigureImage = Record<string, any>;
type FiguresByParagraph = Record<string, FigureImage[]>;

function parseFigureChapter(figureNumber: string | null | undefined): string | null {
  const t = String(figureNumber || '').trim();
  if (!t) return null;
  const m = /^(Afbeelding|Figuur|Fig\.?|Tabel)\s+(\d+)(?:\.\d+)?\s*:/i.exec(t);
  if (!m) return null;
  return String(m[2] || '').trim() || null;
}

function buildIdToChapter(book: any): Map<string, string> {
  const m = new Map<string, string>();
  const walk = (node: any, chapterNum: string) => {
    if (Array.isArray(node)) {
      for (const it of node) walk(it, chapterNum);
      return;
    }
    if (!isObject(node)) return;
    const id = String((node as any).id || '').trim();
    if (id && !m.has(id)) m.set(id, chapterNum);
    if (Array.isArray((node as any).content)) walk((node as any).content, chapterNum);
    if (Array.isArray((node as any).items)) walk((node as any).items, chapterNum);
    if (Array.isArray((node as any).steps)) walk((node as any).steps, chapterNum);
  };

  const chapters = Array.isArray((book as any).chapters) ? ((book as any).chapters as any[]) : [];
  for (const ch of chapters) {
    const chNum = String((ch as any).number || '').trim();
    if (!chNum) continue;
    walk(ch, chNum);
  }
  return m;
}

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function isObject(x: any): x is Record<string, any> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function uniqBySrc(images: FigureImage[]): FigureImage[] {
  const out: FigureImage[] = [];
  const seen = new Set<string>();
  for (const img of images || []) {
    const src = String((img as any)?.src || '').trim();
    const key = src || JSON.stringify(img);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
  }
  return out;
}

function traverseAny(node: any, visit: (obj: Record<string, any>) => void) {
  if (Array.isArray(node)) {
    for (const it of node) traverseAny(it, visit);
    return;
  }
  if (!isObject(node)) return;

  visit(node);

  // Canonical JSON uses `content` arrays nested deeply.
  if (Array.isArray((node as any).content)) traverseAny((node as any).content, visit);

  // Also traverse common container keys if present.
  if (Array.isArray((node as any).chapters)) traverseAny((node as any).chapters, visit);
  if (Array.isArray((node as any).sections)) traverseAny((node as any).sections, visit);
}

async function main() {
  const [inPathArg, figuresPathArg, outPathArg] = process.argv.slice(2);
  if (!inPathArg || !figuresPathArg || !outPathArg) {
    die(
      'Usage: npx tsx new_pipeline/scripts/apply-figures-mapping.ts <in_book.json> <figures_by_paragraph.json> <out_book.json>'
    );
  }

  const inPath = path.resolve(inPathArg);
  const figuresPath = path.resolve(figuresPathArg);
  const outPath = path.resolve(outPathArg);

  if (!fs.existsSync(inPath)) die(`Input book JSON not found: ${inPath}`);
  if (!fs.existsSync(figuresPath)) die(`Figures mapping not found: ${figuresPath}`);

  const book = JSON.parse(fs.readFileSync(inPath, 'utf8')) as any;
  const figures = JSON.parse(fs.readFileSync(figuresPath, 'utf8')) as FiguresByParagraph;

  const idToChapter = buildIdToChapter(book);

  let matchedBlocks = 0;
  let injectedImages = 0;
  let blocksWithExistingImages = 0;
  let skippedCrossChapter = 0;

  traverseAny(book, (obj) => {
    const id = String(obj.id || '').trim();
    if (!id) return;
    const mapped = figures[id];
    if (!mapped || !Array.isArray(mapped) || mapped.length === 0) return;

    const blockChapter = idToChapter.get(id) || null;
    const filtered = blockChapter
      ? mapped.filter((img) => {
          const ch = parseFigureChapter(String((img as any)?.figureNumber || ''));
          if (!ch) return true; // no chapter encoded => keep
          if (ch === blockChapter) return true;
          skippedCrossChapter++;
          return false;
        })
      : mapped;
    if (!filtered || filtered.length === 0) return;

    const existing = Array.isArray(obj.images) ? (obj.images as FigureImage[]) : [];
    if (existing.length > 0) blocksWithExistingImages++;

    const merged = uniqBySrc([...(existing || []), ...filtered]);
    obj.images = merged;

    matchedBlocks++;
    injectedImages += filtered.length;
  });

  fs.writeFileSync(outPath, JSON.stringify(book, null, 2), 'utf8');

  console.log(`✅ Applied figures mapping`);
  console.log(`   in:  ${inPath}`);
  console.log(`   map: ${figuresPath}`);
  console.log(`   out: ${outPath}`);
  console.log(`   matched blocks: ${matchedBlocks}`);
  console.log(`   injected images (raw): ${injectedImages}`);
  console.log(`   blocks already had images: ${blocksWithExistingImages}`);
  if (skippedCrossChapter > 0) {
    console.log(`   skipped cross-chapter images: ${skippedCrossChapter}`);
  }
}

main().catch((e) => die(String((e as any)?.message || e)));


