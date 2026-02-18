/**
 * run-export-figure-manifest.ts
 *
 * Runs the multi-chapter figure manifest exporter (`export-figure-manifest.jsx`) via AppleScript.
 *
 * This produces:
 * - Figure manifest JSON per chapter (caption + label + anchor)
 * - Exported figure PNGs (ingestion-ready for Prince)
 *
 * Usage:
 *   cd new_pipeline
 *   npx tsx extract/run-export-figure-manifest.ts --book <book_id>
 *
 * Or (manual):
 *   npx tsx extract/run-export-figure-manifest.ts --book-id <book_id> --indd /abs/book.indd --chapters 1,2,3
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
  const jsxPath = path.resolve(REPO_ROOT, 'export-figure-manifest.jsx');
  if (!fs.existsSync(jsxPath)) die(`Missing exporter script: ${jsxPath}`);

  const manifest = loadManifest(REPO_ROOT);

  const bookIdArg = String(getArg('--book') || getArg('--book-id') || '').trim();
  const inddArg = String(getArg('--indd') || '').trim();
  const chaptersArg = String(getArg('--chapters') || '').trim();

  if (!bookIdArg) die('Missing --book <book_id> (or --book-id <book_id>)');
  const book = manifest.books.find((b) => b.book_id === bookIdArg);
  if (!book) die(`Book not found in manifest: ${bookIdArg}`);

  const inddPath = inddArg || book.canonical_n4_indd_path;
  if (!inddPath) die('Missing INDD path');
  if (!fs.existsSync(inddPath)) die(`INDD not found: ${inddPath}`);

  const chapters = chaptersArg || (book.chapters || []).join(',');
  if (!chapters) die(`No chapters list for ${bookIdArg} (pass --chapters)`);

  const outDirAbs =
    String(getArg('--out-dir') || '').trim() ||
    path.resolve(REPO_ROOT, 'new_pipeline', 'extract', 'figure_manifests', bookIdArg);
  fs.mkdirSync(outDirAbs, { recursive: true });

  const figuresDirAbs =
    String(getArg('--figures-dir') || '').trim() ||
    path.resolve(REPO_ROOT, 'new_pipeline', 'assets', 'figures_by_book');
  fs.mkdirSync(figuresDirAbs, { recursive: true });

  const figuresDirRel =
    String(getArg('--figures-rel') || '').trim() || 'new_pipeline/assets/figures_by_book';

  const setArgsJs =
    `try { app.scriptArgs.setValue(\\"BIC_BOOK_ID\\", \\"${bookIdArg}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_INDD_PATH\\", \\"${inddPath}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_CHAPTERS\\", \\"${chapters}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_OUT_DIR\\", \\"${outDirAbs}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_FIGURES_DIR\\", \\"${figuresDirAbs}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_FIGURES_REL\\", \\"${figuresDirRel}\\"); } catch(e) {}`;

  const inddVersion = String(getArg('--indesign') || '').trim(); // optional override
  const appName = inddVersion ? `Adobe InDesign ${inddVersion}` : 'Adobe InDesign 2026';
  // Keep timeouts short by default: extraction should be fast. Allow explicit override.
  const timeoutArg = String(getArg('--timeout-seconds') || getArg('--timeout') || '').trim();
  let timeoutSeconds = 1800; // 30 minutes default
  const parsed = Number(timeoutArg);
  if (Number.isFinite(parsed) && parsed > 0) timeoutSeconds = Math.floor(parsed);
  if (hasFlag('--timeout-4h')) timeoutSeconds = 14400;
  if (hasFlag('--timeout-8h')) timeoutSeconds = 28800;

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

  console.log(`Exporting figure manifests + PNGs:`);
  console.log(`  book: ${bookIdArg}`);
  console.log(`  indd: ${inddPath}`);
  console.log(`  chapters: ${chapters}`);
  console.log(`  out: ${outDirAbs}`);
  console.log(`  figures: ${figuresDirAbs} (rel=${figuresDirRel})`);

  const r = spawnSync(apple[0]!, apple.slice(1), { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log('✅ Figure manifest export finished');
}

main();


