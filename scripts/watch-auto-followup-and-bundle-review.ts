/**
 * Watch an auto_followup.log (background chain) and automatically produce a final Prince review bundle
 * once Pass 2 has finished and the Prince build is complete.
 *
 * Why:
 * - Pass 2 improves text quality.
 * - bundle:review (optionally with --fix-hyphenation) is our "typesetting polish" + reproducible artifacts.
 * - This lets the pipeline run hands-off: when Pass 2 is ready, we auto-generate the final review bundle.
 *
 * Usage:
 *   ts-node scripts/watch-auto-followup-and-bundle-review.ts \
 *     --auto-log <path/to/auto_followup.log> \
 *     --book-id MBO_AF4_2024_COMMON_CORE \
 *     --upload <UUID> \
 *     --chapters 1,2,3,...,14 \
 *     --figures new_pipeline/extract/figures_by_paragraph_all.json \
 *     [--bundle-out-dir new_pipeline/output/review_bundles/<name>] \
 *     [--fix-hyphenation] [--fix-hyphenation-max-iters 2] \
 *     [--poll-seconds 30]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tsStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function extractPass2OutDir(logText: string): string | null {
  // Line format in our auto-followup: "[restart] pass2 outDir=/path/to/dir"
  const m = logText.match(/^\[restart\]\s+pass2\s+outDir=(.+)$/m);
  return m ? String(m[1] || '').trim() : null;
}

function hasPrinceFinished(logText: string): boolean {
  return /\bprince book build finished\b/i.test(logText);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const autoLog = typeof args['auto-log'] === 'string' ? path.resolve(String(args['auto-log'])) : '';
  const bookId = typeof args['book-id'] === 'string' ? String(args['book-id']).trim() : '';
  const upload = typeof args.upload === 'string' ? String(args.upload).trim() : '';
  const chaptersCsv = typeof args.chapters === 'string' ? String(args.chapters).trim() : '1,2,3,4,5,6,7,8,9,10,11,12,13,14';
  const figures = typeof args.figures === 'string' ? String(args.figures).trim() : 'new_pipeline/extract/figures_by_paragraph_all.json';

  const pollSecondsRaw = typeof args['poll-seconds'] === 'string' ? Number(String(args['poll-seconds'])) : 30;
  const pollSeconds = Number.isFinite(pollSecondsRaw) && pollSecondsRaw > 1 ? pollSecondsRaw : 30;

  const fixHyphenation = args['fix-hyphenation'] === true;
  const fixHyphItersRaw = typeof args['fix-hyphenation-max-iters'] === 'string' ? Number(String(args['fix-hyphenation-max-iters'])) : 2;
  const fixHyphIters = Number.isFinite(fixHyphItersRaw) && fixHyphItersRaw > 0 ? Math.floor(fixHyphItersRaw) : 2;

  if (!autoLog) die('Missing --auto-log <path>');
  if (!bookId) die('Missing --book-id <id>');
  if (!upload) die('Missing --upload <UUID>');
  if (!fs.existsSync(autoLog)) die(`auto log not found: ${autoLog}`);

  const repoRoot = path.resolve(__dirname, '..');

  const bundleOutDir =
    typeof args['bundle-out-dir'] === 'string'
      ? path.resolve(String(args['bundle-out-dir']))
      : path.resolve(repoRoot, 'new_pipeline', 'output', 'review_bundles', `AUTO_FINAL_${bookId}_${tsStamp()}`);

  const doneMarker = path.join(bundleOutDir, '.done');

  console.log(`👀 Watching auto-followup log: ${autoLog}`);
  console.log(`   poll: ${pollSeconds}s`);
  console.log(`   book: ${bookId}`);
  console.log(`   upload: ${upload}`);
  console.log(`   chapters: ${chaptersCsv}`);
  console.log(`   bundle_out: ${bundleOutDir}`);
  if (fixHyphenation) console.log(`   hyphenation_fix: enabled (maxIters=${fixHyphIters})`);

  for (;;) {
    if (fs.existsSync(doneMarker)) {
      console.log(`✅ Done marker exists: ${doneMarker}`);
      return;
    }

    let logText = '';
    try {
      logText = fs.readFileSync(autoLog, 'utf8');
    } catch {
      logText = '';
    }

    const pass2Dir = extractPass2OutDir(logText);
    if (!pass2Dir) {
      await sleep(pollSeconds * 1000);
      continue;
    }

    const pass2Final = path.resolve(pass2Dir, `rewrites_for_indesign.${bookId}.FINAL.json`);
    if (!fs.existsSync(pass2Final)) {
      await sleep(pollSeconds * 1000);
      continue;
    }

    if (!hasPrinceFinished(logText)) {
      // Wait until the chain's Prince build finishes to avoid heavy parallel runs.
      await sleep(pollSeconds * 1000);
      continue;
    }

    console.log(`🚀 Pass2 final detected: ${pass2Final}`);
    console.log(`🚀 Auto-followup Prince build finished. Producing review bundle...`);

    fs.mkdirSync(bundleOutDir, { recursive: true });

    const bundleArgs: string[] = [
      'run',
      'bundle:review',
      '--',
      '--upload',
      upload,
      '--chapters',
      chaptersCsv,
      '--figures',
      figures,
      '--rewrites',
      pass2Final,
      '--out-dir',
      bundleOutDir,
    ];
    if (fixHyphenation) {
      bundleArgs.push('--fix-hyphenation', '--fix-hyphenation-max-iters', String(fixHyphIters));
    }

    const res = spawnSync('npm', bundleArgs, {
      cwd: path.resolve(repoRoot, 'new_pipeline'),
      stdio: 'inherit',
      env: process.env,
    });
    if (res.status !== 0) die(`bundle:review failed with exit=${res.status}`);

    fs.writeFileSync(doneMarker, new Date().toISOString() + '\n', 'utf8');
    console.log(`✅ Final review bundle complete: ${bundleOutDir}`);
    return;
  }
}

main().catch((e) => die(String(e?.message || e)));
































