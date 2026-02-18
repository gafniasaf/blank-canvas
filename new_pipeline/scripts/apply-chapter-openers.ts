/**
 * apply-chapter-openers.ts
 *
 * Inject per-book chapter opener images into a canonical JSON so Prince can render the correct
 * opener set without relying on a shared `assets/images/chapter_openers/` directory.
 *
 * Default convention (repo-relative):
 *   new_pipeline/assets/books/<book_id>/chapter_openers/chapter_<N>_opener.jpg
 *
 * Usage:
 *   npx tsx scripts/apply-chapter-openers.ts <input_book.json> --out <output.json>
 *
 * Optional:
 *   --book <book_id>                     (otherwise inferred from meta.id via books/manifest.json upload_id)
 *   --openers-dir <repo-rel-or-abs-dir>  (override default directory)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

type Manifest = {
  version: number;
  books: Array<{
    book_id: string;
    upload_id?: string;
  }>;
};

function loadManifest(): Manifest {
  const p = path.resolve(REPO_ROOT, 'books', 'manifest.json');
  if (!fs.existsSync(p)) die(`books/manifest.json not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Manifest;
}

function toRepoRel(absPath: string): string {
  const abs = path.resolve(absPath);
  const rel = path.relative(REPO_ROOT, abs);
  if (!rel.startsWith('..')) return rel.replace(/\\/g, '/');
  return abs.replace(/\\/g, '/');
}

function resolveDir(repoRelOrAbs: string): string {
  const s = String(repoRelOrAbs || '').trim();
  if (!s) return '';
  if (path.isAbsolute(s)) return s;
  return path.resolve(REPO_ROOT, s);
}

function main() {
  const input = process.argv[2];
  if (!input) {
    die('Usage: npx tsx scripts/apply-chapter-openers.ts <input_book.json> --out <output.json> [--book <book_id>] [--openers-dir <dir>]');
  }

  const outPath = getArg('--out');
  if (!outPath) die('Missing --out <output.json>');

  const inputAbs = path.resolve(input);
  if (!fs.existsSync(inputAbs)) die(`Input JSON not found: ${inputAbs}`);
  const book = JSON.parse(fs.readFileSync(inputAbs, 'utf8')) as any;
  if (!book?.chapters || !Array.isArray(book.chapters)) die('Input JSON has no chapters[]');

  const manifest = loadManifest();
  const metaId = String(book?.meta?.id || '').trim();

  let bookId = String(getArg('--book') || '').trim();
  if (!bookId) {
    if (!metaId) die('Cannot infer book_id: JSON meta.id missing; pass --book <book_id>');
    const m = manifest.books.find((b) => String(b.upload_id || '').trim() === metaId);
    if (!m) die(`Cannot infer book_id from meta.id=${metaId}; pass --book <book_id>`);
    bookId = m.book_id;
  }

  const openersDirArg = getArg('--openers-dir');
  const openersDirAbs = openersDirArg
    ? resolveDir(openersDirArg)
    : path.resolve(REPO_ROOT, 'new_pipeline', 'assets', 'books', bookId, 'chapter_openers');

  if (!fs.existsSync(openersDirAbs)) {
    die(`Openers dir not found: ${openersDirAbs}`);
  }

  let applied = 0;
  let missing = 0;

  for (const ch of book.chapters) {
    const chNum = String(ch?.number || '').trim();
    if (!chNum) continue;
    const openerBase = path.resolve(openersDirAbs, `chapter_${chNum}_opener`);
    const openerCandidates = [`${openerBase}.jpg`, `${openerBase}.jpeg`, `${openerBase}.png`];
    let openerAbs: string | null = null;
    for (const cand of openerCandidates) {
      if (fs.existsSync(cand)) {
        openerAbs = cand;
        break;
      }
    }
    if (!openerAbs) {
      missing++;
      continue;
    }
    const srcRel = toRepoRel(openerAbs);
    ch.images = [{ src: srcRel, alt: `Hoofdstuk ${chNum} opener`, width: '100%' }];
    applied++;
  }

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(book, null, 2), 'utf8');

  console.log(`✅ Applied chapter openers`);
  console.log(`   book_id: ${bookId}`);
  console.log(`   openers dir: ${openersDirAbs}`);
  console.log(`   applied: ${applied}`);
  console.log(`   missing: ${missing}`);
  console.log(`   out: ${path.resolve(outPath)}`);
}

main();


