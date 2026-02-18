/**
 * run-book.ts
 *
 * Book-level orchestrator for the chapter-by-chapter InDesign pipeline.
 *
 * This script is intentionally conservative:
 * - It drives InDesign via AppleScript (osascript), because it's stable and easy to reason about.
 * - It does NOT generate JSON. It assumes the caller already created/promoted the correct chapter JSON(s).
 *
 * Usage:
 *   PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx ts-node scripts/run-book.ts --book MBO_AF4_2024_COMMON_CORE --chapters 1 --json /Users/asafgafni/Desktop/rewrites_for_indesign.json
 *
 * Options:
 *   --book <book_id>          Required
 *   --chapters <list>         Comma-separated chapter numbers (e.g. "1,2,3"). If omitted, uses manifest.book.chapters
 *   --json <path>             JSON to apply for ALL chapters in this run (simple mode). If you need per-chapter JSON, run per chapter.
 *   --force-baseline          Force rebuild of chapter-only baselines
 *
 * Outputs:
 * - Uses book.output_root from books/manifest.json
 * - InDesign wrapper scripts write their own report bundles under output_root/reports/ch<N>/<runId>/
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type Manifest = {
  version: number;
  books: Array<{
    book_id: string;
    output_root?: string;
    chapters?: number[];
  }>;
};

function expandTilde(p: string): string {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(process.env.HOME || '', p.slice(2));
  return p;
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function parseChapters(s: string): number[] {
  return s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bookId = String(args.book || '').trim();
  if (!bookId) {
    console.error('Usage: npx ts-node scripts/run-book.ts --book <book_id> [--chapters 1,2,3] [--json /path/to/rewrites.json] [--force-baseline]');
    process.exit(1);
  }

  const manifestPath = path.resolve(__dirname, '..', 'books', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  const book = manifest.books.find((b) => b.book_id === bookId);
  if (!book) {
    console.error(`❌ Book not found in manifest: ${bookId}`);
    process.exit(1);
  }

  const chapters = typeof args.chapters === 'string' ? parseChapters(args.chapters) : (book.chapters || []);
  if (!chapters.length) {
    console.error(`❌ No chapters provided and manifest entry has no chapters list for ${bookId}`);
    process.exit(1);
  }

  const jsonPath = typeof args.json === 'string' ? path.resolve(args.json) : path.resolve(process.env.HOME || '', 'Desktop', 'rewrites_for_indesign.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ JSON not found: ${jsonPath}`);
    process.exit(1);
  }

  const forceBaseline = args['force-baseline'] === true;

  // Export N4 IDML snapshots (manifest-driven)
  console.log(`Exporting canonical IDML snapshots (manifest-driven) via export-n4-idml-from-downloads.jsx...`);
  const exportScript = path.resolve(__dirname, '..', 'export-n4-idml-from-downloads.jsx');
  const exportApple = [
    'osascript',
    '-e',
    `with timeout of 3600 seconds`,
    '-e',
    `tell application "Adobe InDesign 2026"`,
    '-e',
    `activate`,
    // Export only this book's canonical snapshot to keep runs fast and predictable.
    '-e',
    `tell application "Adobe InDesign 2026" to do script "try { app.scriptArgs.setValue(\\"BIC_BOOK_ID\\", \\"${bookId}\\"); } catch(e) {}\\ntry { app.scriptArgs.setValue(\\"BIC_SHOW_ALERTS\\", \\"\\"); } catch(e) {}" language javascript`,
    '-e',
    `do script (POSIX file "${exportScript}") language javascript`,
    '-e',
    `end tell`,
    '-e',
    `end timeout`,
  ];
  {
    const r = spawnSync(exportApple[0]!, exportApple.slice(1), { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }

  // Run per chapter: rewrite wrapper + validation suite wrapper
  const rewriteWrapper = path.resolve(__dirname, '..', 'run-chapter-rewrite-v5-safe.jsx');
  const validateWrapper = path.resolve(__dirname, '..', 'run-chapter-validation-suite-latest.jsx');

  for (const ch of chapters) {
    console.log(`\n=== BOOK ${bookId} :: CHAPTER ${ch} ===`);

    // Wrapper scriptArgs are set inside InDesign; we pass them by embedding an ExtendScript snippet pre-run.
    // Since do script runs a file, we set scriptArgs via AppleScript before calling do script.
    const setArgsApple = (scriptPath: string) => [
      'osascript',
      '-e',
      `with timeout of 3600 seconds`,
      '-e',
      `tell application "Adobe InDesign 2026"`,
      '-e',
      `activate`,
      '-e',
      `tell application "Adobe InDesign 2026" to do script "try { app.scriptArgs.setValue(\\"BIC_BOOK_ID\\", \\"${bookId}\\"); } catch(e) {}\\ntry { app.scriptArgs.setValue(\\"BIC_CHAPTER\\", \\"${ch}\\"); } catch(e) {}\\ntry { app.scriptArgs.setValue(\\"BIC_CHAPTER_FILTER\\", \\"${ch}\\"); } catch(e) {}\\ntry { app.scriptArgs.setValue(\\"BIC_REWRITES_JSON_PATH\\", \\"${jsonPath}\\"); } catch(e) {}\\ntry { app.scriptArgs.setValue(\\"BIC_FORCE_REBUILD_BASELINE\\", \\"${forceBaseline ? 'true' : ''}\\"); } catch(e) {}" language javascript`,
      '-e',
      `do script (POSIX file "${scriptPath}") language javascript`,
      '-e',
      `end tell`,
      '-e',
      `end timeout`,
    ];

    console.log(`Running rewrite wrapper: ${rewriteWrapper}`);
    {
      const r = spawnSync(setArgsApple(rewriteWrapper)[0]!, setArgsApple(rewriteWrapper).slice(1), { stdio: 'inherit' });
      if (r.status !== 0) process.exit(r.status || 1);
    }

    console.log(`Running validation suite: ${validateWrapper}`);
    {
      const r = spawnSync(setArgsApple(validateWrapper)[0]!, setArgsApple(validateWrapper).slice(1), { stdio: 'inherit' });
      if (r.status !== 0) process.exit(r.status || 1);
    }
  }

  console.log(`\n✅ DONE: book run completed for ${bookId}, chapters=${chapters.join(',')}`);
}

main();































