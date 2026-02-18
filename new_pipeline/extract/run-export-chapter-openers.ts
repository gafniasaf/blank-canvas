/**
 * run-export-chapter-openers.ts
 *
 * Runs `new_pipeline/extract/export-chapter-openers.jsx` via AppleScript (osascript).
 *
 * Usage:
 *   cd new_pipeline
 *   npx tsx extract/run-export-chapter-openers.ts --indd /abs/path/to/book.indd --chapters 1,2,3 --out-dir /abs/out --ppi 300
 *
 * Or (manifest-driven):
 *   npx tsx extract/run-export-chapter-openers.ts --book <book_id> [--out-dir /abs/out] [--ppi 300]
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

type Manifest = {
  version: number;
  books: Array<{
    book_id: string;
    canonical_n4_indd_path: string;
    chapters?: number[];
  }>;
};

function loadManifest(repoRoot: string): Manifest {
  const p = path.resolve(repoRoot, 'books', 'manifest.json');
  if (!fs.existsSync(p)) die(`books/manifest.json not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Manifest;
}

function main() {
  const REPO_ROOT = path.resolve(__dirname, '../..');
  const jsxPath = path.resolve(REPO_ROOT, 'new_pipeline', 'extract', 'export-chapter-openers.jsx');
  if (!fs.existsSync(jsxPath)) die(`Missing exporter script: ${jsxPath}`);

  const bookId = String(getArg('--book') || '').trim();
  const inddArg = String(getArg('--indd') || '').trim();
  const chaptersArg = String(getArg('--chapters') || '').trim(); // optional override
  const outDirArg = String(getArg('--out-dir') || '').trim();
  const ppiArg = String(getArg('--ppi') || '').trim();

  let inddPath = inddArg;
  let chapters = chaptersArg;
  let outDir = outDirArg;

  if (bookId) {
    const manifest = loadManifest(REPO_ROOT);
    const book = manifest.books.find((b) => b.book_id === bookId);
    if (!book) die(`Book not found in manifest: ${bookId}`);
    inddPath = inddPath || book.canonical_n4_indd_path;
    if (!chapters) chapters = (book.chapters || []).join(',');
    outDir =
      outDir ||
      path.resolve(REPO_ROOT, 'new_pipeline', 'assets', 'books', bookId, 'chapter_openers');
  } else {
    if (!outDir) die('Missing --out-dir (or pass --book to use manifest default)');
  }

  if (!inddPath) die('Missing --indd (or pass --book)');
  if (!fs.existsSync(inddPath)) die(`INDD not found: ${inddPath}`);

  fs.mkdirSync(outDir, { recursive: true });

  // scriptArgs must be set INSIDE InDesign (separate do script call) before running the file.
  const setArgsJs =
    `try { app.scriptArgs.setValue(\\"BIC_INDD_PATH\\", \\"${inddPath}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_OUT_DIR\\", \\"${outDir}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_CHAPTERS\\", \\"${chapters}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_PPI\\", \\"${ppiArg}\\"); } catch(e) {}`;

  const inddVersion = String(getArg('--indesign') || '').trim(); // optional override (rare)
  const appName = inddVersion ? `Adobe InDesign ${inddVersion}` : 'Adobe InDesign 2026';
  // Keep timeouts short by default: opener export should be fast. Allow explicit override.
  const timeoutArg = String(getArg('--timeout-seconds') || getArg('--timeout') || '').trim();
  let timeoutSeconds = 900; // 15 minutes default
  const parsed = Number(timeoutArg);
  if (Number.isFinite(parsed) && parsed > 0) timeoutSeconds = Math.floor(parsed);
  if (hasFlag('--timeout-4h')) timeoutSeconds = 14400;

  const apple = [
    'osascript',
    '-e',
    `with timeout of ${timeoutSeconds} seconds`,
    '-e',
    `tell application "${appName}"`,
    '-e',
    `activate`,
    '-e',
    `tell application "${appName}" to do script "${setArgsJs}" language javascript`,
    '-e',
    `do script (POSIX file "${jsxPath}") language javascript`,
    '-e',
    `end tell`,
    '-e',
    `end timeout`,
  ];

  console.log(`Exporting chapter openers:`);
  console.log(`  indd: ${inddPath}`);
  console.log(`  out:  ${outDir}`);
  console.log(`  chapters: ${chapters || '(auto)'}${ppiArg ? ` ppi=${ppiArg}` : ''}`);

  const r = spawnSync(apple[0]!, apple.slice(1), { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log('✅ Chapter openers export finished');
}

main();


