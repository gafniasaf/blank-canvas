/**
 * Build + validate a whole-book PDF in the Prince pipeline (multi-chapter).
 *
 * This is the standardized entry point for rendering the full book with:
 * - design tokens + token CSS
 * - canonical export per chapter (+ optional figure injection)
 * - optional rewrites overlay (JSON-first output) applied deterministically by paragraph_id
 * - single merged canonical JSON -> single Prince PDF
 * - layout validations (page fill / column balance / box gaps / no <br> in paragraphs)
 *
 * Usage:
 *   npm run build:book -- --upload <UUID> --chapters 1,2,3 --figures new_pipeline/extract/figures_by_paragraph_all.json --rewrites <final_rewrites.json>
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const PIPELINE_ROOT = path.resolve(REPO_ROOT, 'new_pipeline');

function loadEnvFiles() {
  // Prefer repo-root .env.local (shared across scripts); do not override existing env.
  // Also support the upstream bookautomation env file which is used by DB export scripts.
  const candidates = [
    '/Users/asafgafni/Desktop/bookautomation/book-insight-craft-main/.env',
    path.resolve(REPO_ROOT, '.env.local'),
    path.resolve(REPO_ROOT, '.env'),
    path.resolve(PIPELINE_ROOT, '.env.local'),
    path.resolve(PIPELINE_ROOT, '.env'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: false });
      }
    } catch {
      // ignore
    }
  }
}

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function run(cmd: string, args: string[]) {
  const res = spawnSync(cmd, args, { cwd: PIPELINE_ROOT, stdio: 'inherit', env: process.env });
  if (res.status !== 0) die(`Command failed: ${cmd} ${args.join(' ')}`);
}

function ensureExists(label: string, repoRelPath: string) {
  const abs = path.isAbsolute(repoRelPath) ? repoRelPath : path.resolve(REPO_ROOT, repoRelPath);
  if (!fs.existsSync(abs)) die(`${label} not found: ${abs}`);
}

function resolveInputPath(label: string, p: string): string {
  if (!p) die(`Missing ${label} path`);
  if (path.isAbsolute(p)) {
    if (!fs.existsSync(p)) die(`${label} not found: ${p}`);
    return p;
  }
  const repoAbs = path.resolve(REPO_ROOT, p);
  if (fs.existsSync(repoAbs)) return repoAbs;
  const pipelineAbs = path.resolve(PIPELINE_ROOT, p);
  if (fs.existsSync(pipelineAbs)) return pipelineAbs;
  die(`${label} not found (tried repo root + new_pipeline): ${p}`);
}

function parseChapters(csv: string | null): number[] {
  const raw = String(csv || '').trim();
  if (!raw) return Array.from({ length: 14 }, (_, i) => i + 1);
  return raw
    .split(',')
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

type CanonicalShape = {
  meta?: any;
  chapters?: any[];
};

async function main() {
  loadEnvFiles();

  const upload = getArg('--upload') || '';
  const chapters = parseChapters(getArg('--chapters'));
  const figuresArg = getArg('--figures'); // optional mapping JSON (paragraph_id -> images[])
  const rewritesArg = getArg('--rewrites'); // optional JSON-first rewrites FINAL.json
  const rewriteSkeleton = hasFlag('--rewrite-skeleton') || hasFlag('--skeleton-rewrite');
  const rewriteProvider = String(getArg('--rewrite-provider') || '').trim(); // optional (anthropic|openai)
  const rewriteModel = String(getArg('--rewrite-model') || '').trim(); // optional
  const rewriteOutArg = String(getArg('--rewrite-out') || '').trim(); // optional output path for generated skeleton rewrites
  const errataArg = String(getArg('--errata') || '').trim(); // optional path to factual errata pack
  const maxRepairArg = String(getArg('--rewrite-max-repair') || getArg('--max-repair') || '').trim();
  const factualErrataEnabled = rewriteSkeleton || hasFlag('--factual-errata');
  const idmlArg = getArg('--idml') || '_source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml';

  const outPdf = getArg('--out-pdf') || 'output/book_professional.pdf';
  const outLog = getArg('--out-log') || 'output/book_prince.log';
  const outJsonMerged = getArg('--out-json') || 'output/canonical_book_with_figures.json';
  const outJsonFinal = getArg('--out-json-final') || 'output/canonical_book_with_figures.rewritten.json';

  if (!upload) die('Missing required --upload <UUID>');
  if (!chapters.length) die('No chapters to build');

  const idml = resolveInputPath('IDML snapshot', idmlArg);
  const figures = figuresArg ? resolveInputPath('Figures mapping', figuresArg) : null;
  if (rewriteSkeleton && rewritesArg) die('Cannot use --rewrite-skeleton together with --rewrites. Choose one source of rewrites.');
  let rewrites = rewritesArg ? resolveInputPath('Rewrites JSON', rewritesArg) : null;

  // Step 1: tokens + token CSS once (use chapter 1 tokens as canonical baseline)
  const tokensChapter = chapters.includes(1) ? 1 : chapters[0]!;
  run('tsx', ['extract/parse-idml-design-tokens.ts', idml, '--chapter', String(tokensChapter), '--out', 'new_pipeline/extract/design_tokens.json']);
  run('tsx', [
    'templates/generate-prince-css-from-tokens.ts',
    '--tokens',
    'new_pipeline/extract/design_tokens.json',
    '--base',
    'new_pipeline/templates/prince-af-two-column.css',
    '--out',
    'new_pipeline/templates/prince-af-two-column.tokens.css',
  ]);
  run('tsx', ['validate/verify-design-tokens.ts', 'extract/design_tokens.json']);

  // Step 2: export canonical JSON per chapter (+ optional figures)
  const chapterJsonPaths: string[] = [];
  const skeletonParas: any[] = [];
  for (const ch of chapters) {
    const outJson = `output/canonical_ch${String(ch).padStart(2, '0')}_with_figures.json`;
    const exportArgs = ['export/export-canonical-from-db.ts', upload, '--chapter', String(ch), '--out', outJson];
    if (figures) exportArgs.push('--figures', figures);
    run('tsx', exportArgs);
    run('tsx', ['validate/verify-canonical-vs-db.ts', outJson, '--upload', upload, '--chapter', String(ch)]);
    run('tsx', ['validate/verify-figures.ts', outJson]);
    chapterJsonPaths.push(outJson);

    if (rewriteSkeleton) {
      const skeletonScriptAbs = path.resolve(REPO_ROOT, 'scripts/llm-skeleton-rewrite.ts');
      const skeletonScriptRel = path.relative(PIPELINE_ROOT, skeletonScriptAbs);
      const tmpOut = `output/_tmp_skeleton_rewrites_ch${String(ch).padStart(2, '0')}.json`;
      const args = [skeletonScriptRel, outJson, '--chapter', String(ch), '--out', tmpOut];
      if (rewriteProvider) args.push('--provider', rewriteProvider);
      if (rewriteModel) args.push('--model', rewriteModel);
      if (maxRepairArg) args.push('--max-repair', maxRepairArg);
      if (errataArg) args.push('--errata', resolveInputPath('Errata pack', errataArg));
      run('tsx', args);

      const tmpAbs = path.resolve(PIPELINE_ROOT, tmpOut);
      const tmpJson = JSON.parse(fs.readFileSync(tmpAbs, 'utf8')) as any;
      const paras = Array.isArray(tmpJson?.paragraphs) ? (tmpJson.paragraphs as any[]) : [];
      skeletonParas.push(...paras);
    }
  }

  if (rewriteSkeleton) {
    const out = rewriteOutArg || 'output/book_rewrites.skeleton.json';
    const payload = {
      generated_at: new Date().toISOString(),
      method: 'skeleton-first',
      paragraphs: skeletonParas,
    };
    fs.writeFileSync(path.resolve(PIPELINE_ROOT, out), JSON.stringify(payload, null, 2), 'utf8');
    console.log(`✅ Wrote skeleton rewrites JSON: ${path.resolve(PIPELINE_ROOT, out)}`);
    rewrites = out;
  }

  // Step 3: merge into one canonical JSON
  const merged: CanonicalShape = { meta: undefined, chapters: [] };
  for (const p of chapterJsonPaths) {
    const abs = path.resolve(PIPELINE_ROOT, p);
    const one = JSON.parse(fs.readFileSync(abs, 'utf8')) as CanonicalShape;
    if (!merged.meta) merged.meta = one.meta;
    if (Array.isArray(one.chapters)) merged.chapters!.push(...one.chapters);
  }
  fs.writeFileSync(path.resolve(PIPELINE_ROOT, outJsonMerged), JSON.stringify(merged, null, 2), 'utf8');
  console.log(`✅ Wrote merged canonical JSON: ${path.resolve(PIPELINE_ROOT, outJsonMerged)}`);

  // Step 4: apply rewrites overlay (optional)
  let renderJson = outJsonMerged;
  if (rewrites) {
    run('tsx', ['export/apply-rewrites-overlay.ts', outJsonMerged, rewrites, '--out', outJsonFinal, '--overwrite-boxes']);
    renderJson = outJsonFinal;
  } else {
    // still write a stable "final" path for downstream tooling
    fs.copyFileSync(path.resolve(PIPELINE_ROOT, outJsonMerged), path.resolve(PIPELINE_ROOT, outJsonFinal));
    renderJson = outJsonFinal;
  }

  // Deterministic errata overrides + factual errata gate (recommended for skeleton rewrite flow)
  if (factualErrataEnabled) {
    const errataPath = resolveInputPath('Errata pack', errataArg || 'validate/factual_errata.json');
    const baseNameForErrata = path.basename(renderJson, '.json');
    const errataOutJson = `output/${baseNameForErrata}.errata.json`;
    run('tsx', ['fix/apply-factual-errata-overrides.ts', renderJson, '--out', errataOutJson, '--errata', errataPath]);
    run('tsx', ['validate/verify-factual-errata.ts', errataOutJson, '--errata', errataPath]);
    renderJson = errataOutJson;
  }

  // Deterministic cleanup: the first text under a (sub)heading must not start with a microheading.
  // This strips only *leading* <<MICRO_TITLE>>...<<MICRO_TITLE_END>> markers under Paragraafkop/subparagraph titles.
  {
    const baseNameForMicro = path.basename(renderJson, '.json');
    const microOutJson = `output/${baseNameForMicro}.microfix.json`;
    run('tsx', ['fix/remove-leading-microtitles-under-headings.ts', renderJson, '--out', microOutJson, '--quiet']);
    renderJson = microOutJson;
  }

  // Step 5: render + validate
  // Validation knobs (ignore TOC + opener pages by default)
  const ignoreFirst = getArg('--ignore-first') || '2';
  const minUsed = getArg('--min-used') || '0.50';

  // Typography default: prefer left-aligned / ragged-right for student readability.
  // Override via: --align justify|left
  const align = getArg('--align') || 'left';

  run('tsx', ['renderer/render-prince-pdf.ts', renderJson, '--out', outPdf, '--log', outLog, '--align', align]);
  run('tsx', ['validate/verify-prince-log.ts', outLog]);

  const baseName = path.basename(renderJson, '.json');
  const htmlPath = `output/${baseName}_prince.html`;
  run('tsx', ['validate/verify-no-hard-linebreaks.ts', htmlPath]);
  run('tsx', ['validate/verify-html-anchors.ts', htmlPath]);
  run('python3', ['validate/verify-no-heading-hyphenation.py', outPdf]);
  run('python3', ['validate/verify-bullet-orphan-split.py', outPdf, '--ignore-first', ignoreFirst, '--ignore-last', '1']);
  run('python3', ['validate/verify-justify-gaps.py', outPdf, '--ignore-first', ignoreFirst, '--ignore-last', '1']);

  // Layout gates (ignore TOC + opener pages by default)
  // Whole-book nuance: the last page before a new chapter can be naturally short.
  // We ignore those pages via PDF level-1 bookmarks (chapter starts).
  run('python3', [
    'validate/verify-page-fill.py',
    outPdf,
    '--min-used',
    minUsed,
    '--ignore-first',
    ignoreFirst,
    '--ignore-last',
    '1',
    '--ignore-before-level1',
    '--ignore-before-first-chapter',
  ]);
  run('python3', [
    'validate/verify-column-balance.py',
    outPdf,
    '--ignore-first',
    ignoreFirst,
    '--ignore-last',
    '1',
    '--ignore-before-level1',
    '--ignore-before-first-chapter',
  ]);
  run('python3', ['validate/verify-box-justify-gaps.py', outPdf, '--max-gap-pt', '12', '--ignore-first', ignoreFirst]);

  if (hasFlag('--report')) {
    run('python3', [
      'validate/report-layout.py',
      outPdf,
      '--out-json',
      'output/book_layout_report.json',
      '--out-tsv',
      'output/book_layout_report.tsv',
      '--min-used',
      minUsed,
      '--ignore-first',
      ignoreFirst,
    ]);
  }

  console.log(`✅ Book build complete: ${path.resolve(PIPELINE_ROOT, outPdf)}`);
}

main().catch((e) => die(String(e)));


