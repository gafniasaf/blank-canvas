/**
 * Watch a Pass2 output dir for its FINAL rewrites JSON, then:
 * 1) Run a targeted "quality sweep" (critical-only) using build:book:json-first with --quality-sweep.
 * 2) Produce a final Prince review bundle (PDF + reports) via new_pipeline/bundle:review.
 *
 * This is meant to be run in the background so the process is hands-off.
 *
 * Usage:
 *   npx ts-node scripts/watch-pass2-quality-sweep-and-bundle-review.ts \
 *     --pass2-dir <ABS_PASS2_OUTDIR> \
 *     --book-id MBO_AF4_2024_COMMON_CORE \
 *     --upload <UUID> \
 *     --chapters 1,2,3,...,14 \
 *     --figures new_pipeline/extract/figures_by_paragraph_all.json \
 *     --jobs 2 \
 *     --quality-sweep-max-iters 6 \
 *     --fix-hyphenation --fix-hyphenation-max-iters 2 \
 *     --poll-seconds 30
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

function run(cmd: string, args: string[], opts: { cwd?: string } = {}) {
  const shown = [cmd, ...args].join(' ');
  console.log(`$ ${shown}`);
  const res = spawnSync(cmd, args, { cwd: opts.cwd || process.cwd(), stdio: 'inherit', env: process.env });
  if (res.status !== 0) die(`Command failed (exit=${res.status}): ${shown}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const pass2Dir = typeof args['pass2-dir'] === 'string' ? path.resolve(String(args['pass2-dir'])) : '';
  const bookId = typeof args['book-id'] === 'string' ? String(args['book-id']).trim() : '';
  const upload = typeof args.upload === 'string' ? String(args.upload).trim() : '';
  const chaptersCsv = typeof args.chapters === 'string' ? String(args.chapters).trim() : '1,2,3,4,5,6,7,8,9,10,11,12,13,14';
  const figures = typeof args.figures === 'string' ? String(args.figures).trim() : 'new_pipeline/extract/figures_by_paragraph_all.json';

  const pollSecondsRaw = typeof args['poll-seconds'] === 'string' ? Number(String(args['poll-seconds'])) : 30;
  const pollSeconds = Number.isFinite(pollSecondsRaw) && pollSecondsRaw > 1 ? pollSecondsRaw : 30;

  const jobsRaw = typeof (args as any).jobs === 'string' ? parseInt(String((args as any).jobs), 10) : 2;
  const jobs = Number.isFinite(jobsRaw) && jobsRaw > 0 ? jobsRaw : 2;

  const qsMaxItersRaw = typeof (args as any)['quality-sweep-max-iters'] === 'string' ? parseInt(String((args as any)['quality-sweep-max-iters']), 10) : 6;
  const qsMaxIters = Number.isFinite(qsMaxItersRaw) && qsMaxItersRaw > 0 ? qsMaxItersRaw : 6;

  const fixHyphenation = args['fix-hyphenation'] === true;
  const fixHyphItersRaw = typeof (args as any)['fix-hyphenation-max-iters'] === 'string' ? parseInt(String((args as any)['fix-hyphenation-max-iters']), 10) : 2;
  const fixHyphIters = Number.isFinite(fixHyphItersRaw) && fixHyphItersRaw > 0 ? fixHyphItersRaw : 2;

  if (!pass2Dir) die('Missing required --pass2-dir <dir>');
  if (!bookId) die('Missing required --book-id <id>');
  if (!upload) die('Missing required --upload <UUID>');
  if (!fs.existsSync(pass2Dir)) die(`Pass2 dir not found: ${pass2Dir}`);

  const repoRoot = path.resolve(__dirname, '..');
  const pipelineRoot = path.resolve(repoRoot, 'new_pipeline');

  const pass2Final = path.join(pass2Dir, `rewrites_for_indesign.${bookId}.FINAL.json`);
  const bundleOutDir =
    typeof args['bundle-out-dir'] === 'string'
      ? path.resolve(String(args['bundle-out-dir']))
      : path.resolve(pipelineRoot, 'output', 'review_bundles', `AUTO_QS_FINAL_${bookId}_${tsStamp()}`);

  const doneMarker = path.join(bundleOutDir, '.done');

  console.log(`👀 Watching Pass2 dir for FINAL: ${pass2Final}`);
  console.log(`   poll: ${pollSeconds}s`);
  console.log(`   book: ${bookId}`);
  console.log(`   upload: ${upload}`);
  console.log(`   chapters: ${chaptersCsv}`);
  console.log(`   figures: ${figures}`);
  console.log(`   qs: enabled (maxIters=${qsMaxIters}, jobs=${jobs})`);
  console.log(`   bundle_out: ${bundleOutDir}`);
  if (fixHyphenation) console.log(`   hyphenation_fix: enabled (maxIters=${fixHyphIters})`);

  for (;;) {
    if (fs.existsSync(doneMarker)) {
      console.log(`✅ Done marker exists: ${doneMarker}`);
      return;
    }
    if (!fs.existsSync(pass2Final)) {
      await sleep(pollSeconds * 1000);
      continue;
    }

    console.log(`🚀 Pass2 FINAL detected: ${pass2Final}`);
    console.log(`🚀 Running quality sweep (critical-only) ...`);

    run(
      'npm',
      [
        'run',
        'build:book:json-first',
        '--',
        '--book',
        bookId,
        '--in',
        pass2Final,
        '--out-dir',
        pass2Dir,
        '--seed',
        'approved',
        '--mode',
        'prince',
        '--jobs',
        String(jobs),
        '--resume',
        '--quality-sweep',
        '--quality-sweep-max-iters',
        String(qsMaxIters),
        // Use Claude Opus 4.5 for all roles (writer/checker/repair)
        '--write-if-unchanged',
        '--write-provider',
        'anthropic',
        '--write-model',
        'claude-opus-4-5-20251101',
        '--check-provider',
        'anthropic',
        '--check-model',
        'claude-opus-4-5-20251101',
        '--repair-provider',
        'anthropic',
        '--repair-model',
        'claude-opus-4-5-20251101',
      ],
      { cwd: repoRoot }
    );

    console.log(`🚀 Quality sweep complete. Producing review bundle...`);
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
    if (fixHyphenation) bundleArgs.push('--fix-hyphenation', '--fix-hyphenation-max-iters', String(fixHyphIters));

    run('npm', bundleArgs, { cwd: pipelineRoot });

    fs.writeFileSync(doneMarker, new Date().toISOString() + '\n', 'utf8');
    console.log(`✅ Final review bundle complete: ${bundleOutDir}`);
    return;
  }
}

main().catch((e) => die(String((e as any)?.message || e)));


