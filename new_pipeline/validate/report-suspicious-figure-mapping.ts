/**
 * Report suspicious figure mappings (paragraph_id -> images[]) that are likely to cause
 * misplaced figures (e.g., mapped to section heading blocks like "•Paragraafkop").
 *
 * This is a READ-ONLY diagnostic tool to support the "edit_maps" workflow:
 * - Find bad anchors fast
 * - Patch figures_by_paragraph_all.json directly (or move entries to a better paragraph id)
 *
 * Usage:
 *   npx tsx new_pipeline/validate/report-suspicious-figure-mapping.ts \
 *     --book <book_id> \
 *     --figures new_pipeline/extract/figures_by_paragraph/<book_id>/figures_by_paragraph_all.json \
 *     [--canonical new_pipeline/output/_canonical_jsons_all/<book_id>__canonical_book_with_figures.json]
 *
 * Notes:
 * - We treat a mapping as suspicious when the target block's styleHint looks like a heading
 *   OR when the block basis looks like a pure heading number+title (e.g. "2.1 ...").
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type CanonicalImage = {
  src: string;
  alt?: string;
  figureNumber?: string;
  caption?: string;
  placement?: string;
  width?: string;
};

type FiguresByParagraph = Record<string, CanonicalImage[]>;

type CanonicalBlock = {
  id: string;
  type?: string;
  basis?: string;
  styleHint?: string;
  content?: CanonicalBlock[];
  items?: any[];
  steps?: any[];
};

type CanonicalBook = {
  meta?: { id?: string; title?: string };
  chapters?: Array<{
    number: string;
    title?: string;
    sections?: Array<{
      number: string;
      title?: string | null;
      content?: CanonicalBlock[];
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

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function normStyleHint(styleHint: string | null | undefined): string {
  return String(styleHint || '')
    .toLowerCase()
    .replace(/\s+/g, ''); // "Paragraaf kop" -> "paragraafkop"
}

function isHeadingStyleHint(styleHint: string | null | undefined): boolean {
  const s = normStyleHint(styleHint);
  if (!s) return false;
  if (s.includes('paragraafkop')) return true;
  if (s.includes('subparagraafkop')) return true;
  if (s.includes('hoofdstuk') && (s.includes('kop') || s.includes('titel'))) return true;
  if (s.includes('header')) return true;
  if (s.includes('titel') && !s.includes('fotobijschrift')) return true;
  return false;
}

function looksLikeNumberedHeadingText(basis: string | null | undefined): boolean {
  const t = String(basis || '').trim();
  if (!t) return false;
  // 2.1 Something, 10.1.3 Something, etc.
  return /^\d+(?:\.\d+)+\s+\S/u.test(t);
}

function blockPreview(basis: string | null | undefined): string {
  const t = String(basis || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > 90 ? `${t.slice(0, 90)}…` : t;
}

function buildBlockIndex(book: CanonicalBook): Map<string, CanonicalBlock> {
  const m = new Map<string, CanonicalBlock>();
  const walk = (b: CanonicalBlock) => {
    if (!b || typeof b !== 'object') return;
    if (b.id) m.set(String(b.id), b);
    const inner = Array.isArray(b.content) ? b.content : [];
    for (const x of inner) walk(x);
    const items = Array.isArray(b.items) ? (b.items as any[]) : [];
    for (const it of items) {
      if (it && typeof it === 'object' && (it as any).id) m.set(String((it as any).id), it as any);
    }
    const steps = Array.isArray(b.steps) ? (b.steps as any[]) : [];
    for (const st of steps) {
      if (st && typeof st === 'object' && (st as any).id) m.set(String((st as any).id), st as any);
    }
  };

  for (const ch of book.chapters || []) {
    for (const sec of ch.sections || []) {
      for (const b of sec.content || []) walk(b);
    }
  }
  return m;
}

function main() {
  const bookId = String(getArg('--book') || '').trim();
  const figuresPathArg = getArg('--figures');
  const canonicalPathArg = getArg('--canonical');
  const strict = hasFlag('--strict');

  if (!bookId || !figuresPathArg) {
    die(
      'Usage: npx tsx new_pipeline/validate/report-suspicious-figure-mapping.ts --book <book_id> --figures <figures_by_paragraph_all.json> [--canonical <canonical_book.json>] [--strict]'
    );
  }

  const figuresPath = path.isAbsolute(figuresPathArg)
    ? figuresPathArg
    : path.resolve(process.cwd(), figuresPathArg);
  if (!fs.existsSync(figuresPath)) die(`Figures mapping not found: ${figuresPath}`);

  const canonicalDefault = path.resolve(
    REPO_ROOT,
    'new_pipeline/output/_canonical_jsons_all',
    `${bookId}__canonical_book_with_figures.json`
  );
  const canonicalPath = canonicalPathArg
    ? path.isAbsolute(canonicalPathArg)
      ? canonicalPathArg
      : path.resolve(process.cwd(), canonicalPathArg)
    : canonicalDefault;
  if (!fs.existsSync(canonicalPath)) {
    die(`Canonical book JSON not found: ${canonicalPath} (pass --canonical to override)`);
  }

  const figures = JSON.parse(fs.readFileSync(figuresPath, 'utf8')) as FiguresByParagraph;
  const book = JSON.parse(fs.readFileSync(canonicalPath, 'utf8')) as CanonicalBook;
  const blockIndex = buildBlockIndex(book);

  let totalParas = 0;
  let totalImages = 0;
  let suspiciousParas = 0;
  let suspiciousImages = 0;

  const rows: Array<{
    paragraphId: string;
    styleHint: string;
    preview: string;
    figureNumbers: string[];
  }> = [];

  for (const [pid, imgs] of Object.entries(figures)) {
    totalParas++;
    const arr = Array.isArray(imgs) ? imgs : [];
    totalImages += arr.length;

    const b = blockIndex.get(pid);
    const styleHint = b?.styleHint ? String(b.styleHint) : '';
    const preview = blockPreview(b?.basis);
    const isSus = isHeadingStyleHint(styleHint) || looksLikeNumberedHeadingText(b?.basis);
    if (!isSus) continue;

    suspiciousParas++;
    suspiciousImages += arr.length;
    const figNums = arr
      .map((x) => (x && typeof x === 'object' ? String((x as any).figureNumber || '') : ''))
      .map((x) => x.trim())
      .filter(Boolean);

    rows.push({
      paragraphId: pid,
      styleHint,
      preview,
      figureNumbers: figNums.length ? figNums : [`(no figureNumber; count=${arr.length})`],
    });
  }

  const title = book.meta?.title ? String(book.meta.title) : bookId;
  console.log(`\n📌 Suspicious figure mapping report`);
  console.log(`   book: ${title} (${bookId})`);
  console.log(`   canonical: ${canonicalPath}`);
  console.log(`   figures:   ${figuresPath}`);
  console.log(`\nSummary:`);
  console.log(`   paragraphs with images: ${totalParas}`);
  console.log(`   images mapped:          ${totalImages}`);
  console.log(`   suspicious paragraphs:  ${suspiciousParas}`);
  console.log(`   suspicious images:      ${suspiciousImages}`);

  if (rows.length) {
    console.log(`\nSuspicious anchors (top 60):`);
    for (const r of rows.slice(0, 60)) {
      console.log(`\n- paragraph_id: ${r.paragraphId}`);
      if (r.styleHint) console.log(`  styleHint:    ${r.styleHint}`);
      if (r.preview) console.log(`  basis:        ${r.preview}`);
      console.log(`  figures:      ${r.figureNumbers.join(', ')}`);
    }
    if (rows.length > 60) console.log(`\n... ${rows.length - 60} more`);
  }

  if (strict && rows.length > 0) {
    console.error(`\n❌ strict mode: found ${rows.length} suspicious anchors`);
    process.exit(2);
  }

  console.log('');
}

main();











