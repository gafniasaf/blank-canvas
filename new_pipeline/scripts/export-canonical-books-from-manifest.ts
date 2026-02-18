/**
 * Export canonical per-book JSONs (merged) for all books in books/manifest.json.
 *
 * Goal:
 * - Produce one canonical JSON per book at:
 *   new_pipeline/output/<book_id>/canonical_book_with_figures.json
 *
 * Notes:
 * - Uses DB export (Postgres) via `export/export-canonical-from-db.ts`.
 * - Does NOT render PDFs or run Prince validations (export-only).
 * - Requires the Supabase/Postgres schema that contains:
 *   public.book_uploads, public.book_paragraphs
 *
 * Usage:
 *   cd new_pipeline
 *   npx tsx scripts/export-canonical-books-from-manifest.ts [--book <BOOK_ID>] [--overwrite] [--env-file <PATH>]
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const PIPELINE_ROOT = path.resolve(REPO_ROOT, 'new_pipeline');
const MANIFEST_PATH = path.resolve(REPO_ROOT, 'books', 'manifest.json');

type ManifestBook = {
  book_id: string;
  upload_id?: string;
  canonical_n4_idml_path?: string;
  chapters?: number[];
};

type Manifest = {
  version?: number;
  books?: ManifestBook[];
};

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

function ensureDir(absDir: string) {
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
}

function resolvePathFromRepo(p: string): string {
  if (!p) return '';
  if (path.isAbsolute(p)) return p;
  // Manifest paths often start with "./" — safe to resolve from repo root.
  return path.resolve(REPO_ROOT, p);
}

function resolveEnvFile(): string | null {
  const cli = String(getArg('--env-file') || '').trim();
  if (cli) {
    const abs = path.isAbsolute(cli) ? cli : path.resolve(REPO_ROOT, cli);
    if (!fs.existsSync(abs)) die(`--env-file not found: ${abs}`);
    return abs;
  }

  const envFromVar = String(process.env.ENV_FILE || '').trim();
  if (envFromVar) {
    const abs = path.isAbsolute(envFromVar) ? envFromVar : path.resolve(REPO_ROOT, envFromVar);
    if (fs.existsSync(abs)) return abs;
  }

  // Convenience: match build-book.ts behavior (shared local Supabase project).
  const bookautomationEnv = '/Users/asafgafni/Desktop/bookautomation/book-insight-craft-main/.env';
  if (fs.existsSync(bookautomationEnv)) return bookautomationEnv;

  // Fallback: rely on export script's own loadEnv() candidates (.env/.env.local)
  return null;
}

function run(cmd: string, args: string[]) {
  const res = spawnSync(cmd, args, { cwd: PIPELINE_ROOT, stdio: 'inherit', env: process.env });
  if (res.status !== 0) {
    die(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

type CanonicalShape = { meta?: any; chapters?: any[] };

function readJson(absPath: string): any {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function padChapter(n: number): string {
  const s = String(n);
  if (s.length >= 2) return s;
  return s.padStart(2, '0');
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) die(`Manifest not found: ${MANIFEST_PATH}`);

  const manifest = readJson(MANIFEST_PATH) as Manifest;
  const books = Array.isArray(manifest.books) ? manifest.books : [];

  const onlyBook = String(getArg('--book') || '').trim();
  const overwrite = hasFlag('--overwrite') || hasFlag('--force');

  const envFile = resolveEnvFile();
  if (envFile) {
    console.log(`🔐 Using env file: ${envFile}`);
  } else {
    console.log(`🔐 No --env-file provided; relying on process env / repo .env(.local).`);
  }

  const targetBooks = books
    .map((b) => ({
      book_id: String(b.book_id || '').trim(),
      upload_id: String(b.upload_id || '').trim(),
      canonical_n4_idml_path: String(b.canonical_n4_idml_path || '').trim(),
      chapters: Array.isArray(b.chapters) ? (b.chapters as number[]) : [],
    }))
    .filter((b) => !!b.book_id)
    .filter((b) => (!onlyBook ? true : b.book_id === onlyBook));

  if (!targetBooks.length) {
    die(onlyBook ? `No matching book found in manifest for --book ${onlyBook}` : 'No books found in manifest.');
  }

  let generated = 0;
  let skipped = 0;

  for (const book of targetBooks) {
    const bookId = book.book_id;
    const uploadId = book.upload_id;
    const idmlRel = book.canonical_n4_idml_path;
    const chapters = (book.chapters || []).filter((n) => Number.isFinite(n) && n > 0);

    if (!uploadId) die(`Missing upload_id for book ${bookId} in manifest.json`);
    if (!chapters.length) die(`No chapters declared for book ${bookId} in manifest.json`);

    const outDirRel = path.join('output', bookId);
    const outDirAbs = path.resolve(PIPELINE_ROOT, outDirRel);
    ensureDir(outDirAbs);

    const outBookRel = path.join(outDirRel, 'canonical_book_with_figures.json');
    const outBookAbs = path.resolve(PIPELINE_ROOT, outBookRel);

    if (!overwrite && fs.existsSync(outBookAbs)) {
      console.log(`✅ [skip] ${bookId}: already exists: ${outBookAbs}`);
      skipped++;
      continue;
    }

    const resolvedIdmlAbs = idmlRel ? resolvePathFromRepo(idmlRel) : '';
    if (idmlRel && !fs.existsSync(resolvedIdmlAbs)) {
      die(`IDML snapshot missing for book ${bookId}: ${resolvedIdmlAbs}`);
    }

    console.log(`\n📦 Exporting canonical JSON for: ${bookId}`);
    console.log(`   upload_id: ${uploadId}`);
    console.log(`   chapters: ${chapters.join(',')}`);

    const chapterJsonRelPaths: string[] = [];
    for (const ch of chapters) {
      const outChRel = path.join(outDirRel, `canonical_ch${padChapter(ch)}_with_figures.json`);
      const outChAbs = path.resolve(PIPELINE_ROOT, outChRel);

      if (!overwrite && fs.existsSync(outChAbs)) {
        chapterJsonRelPaths.push(outChRel);
        continue;
      }

      const args: string[] = [
        'export/export-canonical-from-db.ts',
        uploadId,
        '--chapter',
        String(ch),
        '--out',
        outChRel,
      ];
      if (envFile) args.push('--env-file', envFile);
      if (idmlRel) args.push('--idml', idmlRel.replace(/^\.\//, ''));

      // Use tsx directly (repo uses it everywhere); require non-interactive.
      run('tsx', args);
      chapterJsonRelPaths.push(outChRel);
    }

    // Merge chapters → one book JSON
    const merged: CanonicalShape = { meta: undefined, chapters: [] };
    for (const rel of chapterJsonRelPaths) {
      const abs = path.resolve(PIPELINE_ROOT, rel);
      const one = readJson(abs) as CanonicalShape;
      if (!merged.meta) merged.meta = one.meta;
      if (Array.isArray(one.chapters)) merged.chapters!.push(...one.chapters);
    }

    fs.writeFileSync(outBookAbs, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`✅ Wrote merged canonical JSON: ${outBookAbs}`);
    generated++;
  }

  console.log(`\n🎉 Done.`);
  console.log(`   generated: ${generated}`);
  console.log(`   skipped:   ${skipped}`);
}

main().catch((e) => {
  console.error('❌ export-canonical-books-from-manifest failed:', e?.message || String(e));
  process.exit(1);
});








