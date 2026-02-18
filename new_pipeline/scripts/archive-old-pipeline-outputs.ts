/**
 * Archive "old pipeline" outputs (full_rewritten*) into a versioned backup folder,
 * with a manifest so we can always find the exact previous PDFs/logs/JSONs.
 *
 * This is intended to run BEFORE generating skeleton-first outputs for those books.
 *
 * Usage (from repo root or new_pipeline/):
 *   npx tsx new_pipeline/scripts/archive-old-pipeline-outputs.ts
 *   npx tsx new_pipeline/scripts/archive-old-pipeline-outputs.ts --version 20260104_120000
 *
 * Output:
 *   _backups/pipeline_archives/<version>/MANIFEST.md
 *   _backups/pipeline_archives/<version>/old_pipeline_outputs/...
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const PIPELINE_OUT = path.resolve(REPO_ROOT, 'new_pipeline', 'output');

type Manifest = {
  version?: number;
  books?: Array<{ book_id: string }>;
};

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return String(v);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function timestampId(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function sha256File(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function ensureDir(absDir: string) {
  fs.mkdirSync(absDir, { recursive: true });
}

function walkFiles(absDir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [absDir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

// Mapping from manifest book_id to the filename prefix used in the old pipeline outputs.
// (Most match the short slug; AF4 historically used "af4_opus_45".)
const OLD_OUTPUT_PREFIX_BY_BOOK_ID: Record<string, string> = {
  MBO_AF4_2024_COMMON_CORE: 'af4_opus_45',
  MBO_COMMUNICATIE_9789083251387_03_2024: 'communicatie',
  MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_9789083412030_03_2024: 'klinisch_redeneren',
  MBO_METHODISCH_WERKEN_9789083251394_03_2024: 'methodisch_werken',
  MBO_WETGEVING_9789083412061_03_2024: 'wetgeving',
  MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024: 'persoonlijke_verzorging',
};

function hasSkeletonPass1Pdf(prefix: string): boolean {
  // Keep this conservative: any skeleton-pass1 PDF for this prefix means the book has already been migrated.
  const candidates = [
    path.resolve(PIPELINE_OUT, `${prefix}_full_skeleton_pass1_professional.with_openers.no_figures.pdf`),
    path.resolve(PIPELINE_OUT, `${prefix}_full_skeleton_pass1_professional.with_openers.with_figures.pdf`),
  ];
  return candidates.some((p) => fs.existsSync(p));
}

function main() {
  const version = String(getArg('--version') || '').trim() || timestampId();
  const outRoot = path.resolve(REPO_ROOT, '_backups', 'pipeline_archives', version);
  const outFilesRoot = path.resolve(outRoot, 'old_pipeline_outputs');
  ensureDir(outFilesRoot);

  const manifestPath = path.resolve(REPO_ROOT, 'books', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`books/manifest.json not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  const books = Array.isArray(manifest.books) ? manifest.books : [];

  // Pre-scan output once (faster than re-walking per book).
  const allFiles = walkFiles(PIPELINE_OUT);

  const copiedByBook: Array<{
    book_id: string;
    old_prefix: string;
    copied: Array<{ src: string; dest: string; size: number; mtime: string; sha256?: string }>;
    skipped_reason?: string;
  }> = [];

  for (const b of books) {
    const bookId = String(b.book_id || '').trim();
    if (!bookId) continue;
    const prefix = OLD_OUTPUT_PREFIX_BY_BOOK_ID[bookId];
    if (!prefix) {
      copiedByBook.push({
        book_id: bookId,
        old_prefix: '',
        copied: [],
        skipped_reason: 'No old-output prefix mapping (not archiving).',
      });
      continue;
    }

    if (hasSkeletonPass1Pdf(prefix)) {
      copiedByBook.push({
        book_id: bookId,
        old_prefix: prefix,
        copied: [],
        skipped_reason: 'Already has skeleton-pass1 PDF (not considered “older pipeline”).',
      });
      continue;
    }

    const matches = allFiles
      .filter((abs) => {
        const base = path.basename(abs);
        return base.includes(prefix) && base.includes('full_rewritten');
      })
      .sort((a, b2) => a.localeCompare(b2, 'en'));

    if (!matches.length) {
      copiedByBook.push({
        book_id: bookId,
        old_prefix: prefix,
        copied: [],
        skipped_reason: 'No full_rewritten* outputs found to archive.',
      });
      continue;
    }

    const copied: Array<{ src: string; dest: string; size: number; mtime: string; sha256?: string }> = [];

    for (const srcAbs of matches) {
      const relFromOut = path.relative(PIPELINE_OUT, srcAbs);
      const destAbs = path.resolve(outFilesRoot, relFromOut);
      ensureDir(path.dirname(destAbs));

      const st = fs.statSync(srcAbs);
      fs.copyFileSync(srcAbs, destAbs);
      // Preserve mtime/atime for traceability.
      try {
        fs.utimesSync(destAbs, st.atime, st.mtime);
      } catch {
        // ignore
      }

      const sha =
        srcAbs.toLowerCase().endsWith('.pdf') || srcAbs.toLowerCase().endsWith('.json')
          ? sha256File(srcAbs)
          : undefined;

      copied.push({
        src: path.relative(REPO_ROOT, srcAbs).replace(/\\/g, '/'),
        dest: path.relative(REPO_ROOT, destAbs).replace(/\\/g, '/'),
        size: st.size,
        mtime: st.mtime.toISOString(),
        sha256: sha,
      });
    }

    copiedByBook.push({ book_id: bookId, old_prefix: prefix, copied });
  }

  const lines: string[] = [];
  lines.push(`# Pipeline archive: ${version}`);
  lines.push('');
  lines.push(`- Created at: ${new Date().toISOString()}`);
  lines.push(`- Repo root: \`${REPO_ROOT}\``);
  lines.push(`- Note: this repo has no git metadata available (no commit SHA).`);
  lines.push('');
  lines.push('## What was archived');
  lines.push('');
  lines.push(`Archived files were copied from \`new_pipeline/output/**\` into:`);
  lines.push('');
  lines.push(`- \`${path.relative(REPO_ROOT, outFilesRoot).replace(/\\/g, '/')}\``);
  lines.push('');
  lines.push('## Per-book listing');
  lines.push('');

  for (const entry of copiedByBook) {
    lines.push(`### ${entry.book_id}`);
    if (entry.old_prefix) lines.push(`- Old output prefix: \`${entry.old_prefix}\``);
    if (entry.skipped_reason) {
      lines.push(`- Skipped: ${entry.skipped_reason}`);
      lines.push('');
      continue;
    }
    lines.push(`- Files copied: **${entry.copied.length}**`);
    lines.push('');
    for (const f of entry.copied) {
      lines.push(`- \`${f.src}\``);
      lines.push(`  - dest: \`${f.dest}\``);
      lines.push(`  - size: ${f.size} bytes`);
      lines.push(`  - mtime: ${f.mtime}`);
      if (f.sha256) lines.push(`  - sha256: \`${f.sha256}\``);
    }
    lines.push('');
  }

  const manifestOut = path.resolve(outRoot, 'MANIFEST.md');
  fs.writeFileSync(manifestOut, lines.join('\n'), 'utf8');
  console.log(`✅ Archived old-pipeline outputs to: ${outRoot}`);
  console.log(`🧾 Manifest: ${manifestOut}`);
}

main();










