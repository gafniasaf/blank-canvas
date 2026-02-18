/**
 * run-export-figure-overlays.ts
 *
 * Runs the InDesign overlay exporter (exporting callouts/labels baked into figure PNGs),
 * driven by books/manifest.json + figure_manifest_ch<N>.json files.
 *
 * Usage:
 *   cd new_pipeline
 *   npm run export:figure-overlays -- --book MBO_AF4_2024_COMMON_CORE --chapters 1,2
 *
 * Optional:
 *   --ppi 600
 *   --margin-mm 6
 *   --force
 *
 * Notes:
 * - Requires Adobe InDesign on this machine.
 * - Uses AppleScript (osascript) to call InDesign and execute the .jsx.
 */

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

function main() {
  const bookId = String(getArg('--book') || '').trim();
  if (!bookId) die('Missing --book <book_id>');

  const chapters = String(getArg('--chapters') || '').trim(); // optional "1,2,3"
  const force = hasFlag('--force');
  const ppi = String(getArg('--ppi') || '').trim();
  const marginMm = String(getArg('--margin-mm') || '').trim();

  const REPO_ROOT = path.resolve(__dirname, '../..');
  const jsxPath = path.resolve(REPO_ROOT, 'new_pipeline', 'extract', 'export-figure-overlays.jsx');

  // IMPORTANT: follow the escaping pattern used elsewhere in this repo (see scripts/run-book.ts):
  // - Use AppleScript do script "... \n ... " where \n is passed as "\\n" so InDesign interprets it as a newline.
  // - Escape quotes as \\" inside the AppleScript string.
  // IMPORTANT: Always set (or clear) args so we don't accidentally reuse stale values from a prior run.
  const setArgsJs =
    `try { app.scriptArgs.setValue(\\"BIC_BOOK_ID\\", \\"${bookId}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_CHAPTERS\\", \\"${chapters}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_FORCE\\", \\"${force ? 'true' : ''}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_PPI\\", \\"${ppi}\\"); } catch(e) {}` +
    `\\ntry { app.scriptArgs.setValue(\\"BIC_MARGIN_MM\\", \\"${marginMm}\\"); } catch(e) {}`;

  const apple = [
    'osascript',
    '-e',
    `with timeout of 3600 seconds`,
    '-e',
    `tell application "Adobe InDesign 2026"`,
    '-e',
    `activate`,
    '-e',
    `tell application "Adobe InDesign 2026" to do script "${setArgsJs}" language javascript`,
    '-e',
    `do script (POSIX file "${jsxPath}") language javascript`,
    '-e',
    `end tell`,
    '-e',
    `end timeout`,
  ];

  console.log(
    `Running InDesign overlay export: book=${bookId}` +
      (chapters ? ` chapters=${chapters}` : '') +
      (force ? ' --force' : '') +
      (ppi ? ` --ppi ${ppi}` : '') +
      (marginMm ? ` --margin-mm ${marginMm}` : '')
  );
  const r = spawnSync(apple[0]!, apple.slice(1), { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log('✅ Overlay export finished');
}

main();


