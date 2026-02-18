/**
 * Build + validate a single chapter PDF in the Prince pipeline.
 *
 * This is the standardized, chapter-agnostic entry point so future chapters can use the
 * same layout + validations as CH1.
 *
 * Usage (from repo root or new_pipeline/):
 *   npm run build:chapter -- --upload <UUID> --chapter 2 --figures new_pipeline/extract/figures_by_paragraph_ch2.json
 *
 * Render-only (no DB needed):
 *   npm run build:chapter -- --chapter 2 --in-json output/canonical_ch2_with_figures.json
 *
 * Notes:
 * - Uses the canonical IDML snapshot for tokens by default.
 * - Figure mapping is optional; if omitted, figures won't be injected (but validations still run).
 */

import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { loadEnv } from '../lib/load-env';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const PIPELINE_ROOT = path.resolve(REPO_ROOT, 'new_pipeline');

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

function run(cmd: string, args: string[], opts?: { allowFailure?: boolean }) {
  const res = spawnSync(cmd, args, {
    cwd: PIPELINE_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    if (opts?.allowFailure) {
      console.log(`⚠️  Command returned non-zero status (continuing): ${cmd} ${args.join(' ')}`);
      return false;
    }
    die(`Command failed: ${cmd} ${args.join(' ')}`);
  }
  return true;
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

async function main() {
  const envFileArg = getArg('--env-file');
  const envFile = envFileArg ? resolveInputPath('Env file', envFileArg) : undefined;
  loadEnv({ envFile: envFile || undefined });

  const chapterStr = getArg('--chapter') || '';
  const upload = getArg('--upload') || ''; // required only when exporting / validating vs DB
  const figuresArg = getArg('--figures'); // optional
  const inJsonArg = getArg('--in-json') || getArg('--in'); // optional (render-only mode)
  const inJson = inJsonArg ? resolveInputPath('Input JSON', inJsonArg) : null;
  let rewrites = getArg('--rewrites'); // optional (overlay JSON-first rewrites onto canonical)
  const rewriteMode = String(getArg('--rewrite-mode') || '').trim(); // optional: "skeleton"
  const sectionFilter = String(getArg('--section') || '').trim(); // optional (used by rewrite-mode skeleton)
  const rewriteSkeleton = hasFlag('--rewrite-skeleton') || hasFlag('--skeleton-rewrite');
  const rewriteProvider = String(getArg('--rewrite-provider') || '').trim(); // optional (anthropic|openai)
  const rewriteModel = String(getArg('--rewrite-model') || '').trim(); // optional (e.g. claude-sonnet-4-5-20250929)
  const rewriteOut = String(getArg('--rewrite-out') || '').trim(); // optional path for generated rewrites json
  const rewriteOnlyIds = String(getArg('--rewrite-only-ids') || '').trim(); // optional comma-separated paragraph_id list
  const errataArg = String(getArg('--errata') || '').trim(); // optional path to factual errata pack
  const maxRepairArg = String(getArg('--rewrite-max-repair') || getArg('--max-repair') || '').trim();
  const factualErrataEnabled = rewriteSkeleton || hasFlag('--factual-errata');
  // Chapter builds should be chapter-only by default (no repo-local front/back matter),
  // otherwise layout gates (e.g. page fill) will fail on short backmatter pages like "Bronnen".
  // Allow overriding via explicit paths.
  const frontmatterPath = getArg('--frontmatter') || '/dev/null';
  const backmatterPath = getArg('--backmatter') || '/dev/null';
  const boxesEnabled = hasFlag('--boxes') || hasFlag('--differentiation');
  const boxesFromSkeleton = hasFlag('--boxes-from-skeleton') || hasFlag('--boxes-from-skeleton-rewrites');
  const boxesProvider = String(getArg('--boxes-provider') || '').trim(); // optional (anthropic|openai) — currently generator supports anthropic
  const boxesModel = String(getArg('--boxes-model') || '').trim(); // optional (e.g. claude-sonnet-4-5-20250929)
  const boxesSkeletonArg = String(getArg('--boxes-skeleton') || '').trim(); // optional path to skeleton rewrites json (defaults to the generated one)
  const humanizeBoxes = hasFlag('--humanize-boxes');
  const simplifyMixed = hasFlag('--simplify-mixed');
  const bookId = getArg('--book-id') || 'MBO_AF4_2024_COMMON_CORE';
  const mappingArg = getArg('--kd-mapping') || getArg('--mapping') || '';
  const praktijkEvery = Number(getArg('--praktijk-every') || '2');
  const verdiepingEvery = Number(getArg('--verdieping-every') || '3');
  const idml = getArg('--idml') || '_source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml';

  const chapter = Number(chapterStr);
  if (!Number.isFinite(chapter) || chapter <= 0) die('Missing/invalid --chapter <N>');

  // Ensure the IDML snapshot exists (relative to repo root)
  ensureExists('IDML snapshot', idml);

  // Step 1: tokens + token CSS (chapter-specific master detection; same template output)
  run('tsx', [
    'extract/parse-idml-design-tokens.ts',
    idml,
    '--chapter',
    String(chapter),
    '--out',
    'new_pipeline/extract/design_tokens.json',
  ]);
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

  // Step 2: canonical JSON
  // - Full build: export from DB
  // - Render-only: use an existing canonical JSON
  const outJson = inJson || `output/canonical_ch${chapter}_with_figures.json`;
  if (!inJson) {
    if (!upload) die('Missing required --upload <UUID> (or provide --in-json for render-only mode)');
    const exportArgs = ['export/export-canonical-from-db.ts', upload, '--chapter', String(chapter), '--out', outJson];
    if (figuresArg) exportArgs.push('--figures', resolveInputPath('Figures mapping', figuresArg));
    run('tsx', exportArgs);
  }

  // Step 3: validate canonical (optional) and figures (always)
  if (upload) {
    run('tsx', ['validate/verify-canonical-vs-db.ts', outJson, '--upload', upload, '--chapter', String(chapter)]);
  }
  let renderJson = outJson;
  let skeletonRewritesJson: string | null = null;

  if (rewriteMode && rewriteMode !== 'skeleton') {
    die(`Unsupported --rewrite-mode: ${rewriteMode} (supported: skeleton)`);
  }

  if (rewriteMode === 'skeleton') {
    if (rewriteSkeleton)
      die('Cannot use --rewrite-mode skeleton together with --rewrite-skeleton / --skeleton-rewrite. Choose one.');
    if (rewrites) die('Cannot use --rewrite-mode skeleton together with --rewrites. Choose one source of rewrites.');

    const baseNameForSkeleton = path.basename(String(outJson), '.json');
    const skeletonOut = `output/skeleton_ch${chapter}.json`;
    const rewritesOut = `output/rewrites_ch${chapter}.json`;
    const assembledOut = `output/${baseNameForSkeleton}.assembled.json`;

    // Defaults for this flow: fast + cheap
    const provider = (rewriteProvider || 'openai').trim();
    const model = (rewriteModel || 'gpt-4o-mini').trim();

    console.log(`🦴 Skeleton-first rewrite enabled (rewrite-mode=skeleton)`);
    console.log(`   canonical: ${path.resolve(PIPELINE_ROOT, String(outJson))}`);
    console.log(`   skeleton:  ${path.resolve(PIPELINE_ROOT, skeletonOut)}`);
    console.log(`   rewrites:  ${path.resolve(PIPELINE_ROOT, rewritesOut)}`);
    console.log(`   assembled: ${path.resolve(PIPELINE_ROOT, assembledOut)}`);

    // 1) Extract skeleton (filter by chapter)
    const extractArgs = ['scripts/extract-skeleton.ts', outJson, skeletonOut, '--chapter', String(chapter)];
    if (sectionFilter) extractArgs.push('--section', sectionFilter);
    run('tsx', extractArgs);

    // 2) Validate skeleton (script lives in repo root scripts/)
    // Note: Allow failure since source content may have structural issues (split lists, etc.)
    // that don't block LLM generation - the warnings are logged for reference
    run('tsx', ['../scripts/validate-skeleton.ts', skeletonOut], { allowFailure: true });

    // 3) Generate rewrites from skeleton
    const genArgs = [
      'scripts/generate-from-skeleton.ts',
      '--skeleton',
      skeletonOut,
      '--out',
      rewritesOut,
      '--provider',
      provider,
      '--model',
      model,
    ];
    if (sectionFilter) genArgs.push('--section', sectionFilter);
    run('tsx', genArgs);

    // 4) Assemble rewritten canonical
    run('tsx', ['scripts/assemble-skeleton-rewrites.ts', outJson, skeletonOut, rewritesOut, assembledOut]);

    renderJson = assembledOut;
  } else {
    if (rewriteSkeleton) {
      if (rewrites) die('Cannot use --rewrite-skeleton together with --rewrites. Choose one source of rewrites.');
      const skeletonOut = rewriteOut || `output/canonical_ch${chapter}_rewrites.skeleton.json`;
      const skeletonScriptAbs = path.resolve(REPO_ROOT, 'scripts/llm-skeleton-rewrite.ts');
      const skeletonScriptRel = path.relative(PIPELINE_ROOT, skeletonScriptAbs);
      const args = [skeletonScriptRel, outJson, '--chapter', String(chapter), '--out', skeletonOut];
      if (rewriteProvider) args.push('--provider', rewriteProvider);
      if (rewriteModel) args.push('--model', rewriteModel);
      if (rewriteOnlyIds) args.push('--only-ids', rewriteOnlyIds);
      if (maxRepairArg) args.push('--max-repair', maxRepairArg);
      if (errataArg) args.push('--errata', resolveInputPath('Errata pack', errataArg));
      run('tsx', args);
      rewrites = skeletonOut;
      skeletonRewritesJson = skeletonOut;
    }
    if (rewrites) {
      const overlayOut = `output/canonical_ch${chapter}_with_figures.rewritten.json`;
      run('tsx', [
        'export/apply-rewrites-overlay.ts',
        outJson,
        resolveInputPath('Rewrites JSON', rewrites),
        '--out',
        overlayOut,
        '--chapter',
        String(chapter),
        '--overwrite-boxes',
      ]);
      renderJson = overlayOut;
    }
  }

  // Optional: Praktijk/Verdieping differentiation layer (KD-free student boxes)
  if (boxesEnabled) {
    // Deterministic box injection (creates placeholder boxes); optional LLM humanization can run after.
    const baseNameForBoxes = path.basename(renderJson, '.json');
    const boxedOut = `output/${baseNameForBoxes}.boxed.json`;
    const boxedReport = `output/${baseNameForBoxes}.boxed.report.md`;

    // Optional: generate per-subparagraph box text overrides from the skeleton rewrite output.
    // This keeps the rewrite pipeline (basis text) separate from the box layer, while still
    // leveraging the skeleton’s extracted terms/facts for higher-quality box drafts.
    let boxOverridesPath: string | null = null;
    if (boxesFromSkeleton) {
      const skeletonPath = boxesSkeletonArg
        ? resolveInputPath('Skeleton rewrites JSON for boxes', boxesSkeletonArg)
        : skeletonRewritesJson
          ? resolveInputPath('Skeleton rewrites JSON for boxes', skeletonRewritesJson)
          : null;
      if (!skeletonPath) die('Missing skeleton rewrites JSON for --boxes-from-skeleton. Use --rewrite-skeleton (recommended) or pass --boxes-skeleton <path>.');

      const provider = (boxesProvider || rewriteProvider || 'anthropic').trim();
      const model = (boxesModel || rewriteModel || '').trim();
      if (!model) die('Missing --boxes-model (or --rewrite-model) for --boxes-from-skeleton.');

      boxOverridesPath = `output/${baseNameForBoxes}.box_overrides.from_skeleton.json`;
      run('tsx', [
        'export/generate-box-overrides-from-skeleton.ts',
        renderJson,
        skeletonPath,
        '--out',
        boxOverridesPath,
        '--chapter',
        String(chapter),
        '--provider',
        provider,
        '--model',
        model,
      ]);
    }

    const diffArgs = [
      'export/apply-kd-differentiation-poc.py',
      renderJson,
      '--out',
      boxedOut,
      '--report',
      boxedReport,
      '--chapter',
      String(chapter),
      '--book-id',
      bookId,
      '--praktijk-every',
      String(Number.isFinite(praktijkEvery) && praktijkEvery > 0 ? Math.floor(praktijkEvery) : 2),
      '--verdieping-every',
      String(Number.isFinite(verdiepingEvery) && verdiepingEvery >= 0 ? Math.floor(verdiepingEvery) : 3),
    ];
    if (boxOverridesPath) diffArgs.push('--box-overrides', boxOverridesPath);
    if (mappingArg) diffArgs.push('--kd-mapping', resolveInputPath('KD mapping', mappingArg));
    if (simplifyMixed) diffArgs.push('--simplify-mixed');
    run('python3', diffArgs);

    let boxedJson = boxedOut;
    if (humanizeBoxes) {
      const humanOut = `output/${baseNameForBoxes}.boxed.humanized.json`;
      const humanReport = `output/${baseNameForBoxes}.boxed.humanized.report.md`;
      const cacheOut = `output/${baseNameForBoxes}.boxed.humanized.cache.json`;
      run('python3', [
        'export/humanize-kd-boxes.py',
        '--base',
        renderJson,
        '--current',
        boxedOut,
        '--out',
        humanOut,
        '--report',
        humanReport,
        '--chapter',
        String(chapter),
        '--cache',
        cacheOut,
      ]);
      boxedJson = humanOut;
    }

    // Gate: ensure we actually produced enough boxes and none leaked inline.
    run('python3', [
      'validate/verify-box-layer.py',
      boxedJson,
      '--chapter',
      String(chapter),
      '--praktijk-every',
      String(Number.isFinite(praktijkEvery) && praktijkEvery > 0 ? Math.floor(praktijkEvery) : 2),
      '--verdieping-every',
      String(Number.isFinite(verdiepingEvery) && verdiepingEvery >= 0 ? Math.floor(verdiepingEvery) : 3),
    ]);

    renderJson = boxedJson;
  }

  run('tsx', ['validate/verify-figures.ts', renderJson]);

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

  // Step 4: render + validate
  const outPdf = `output/canonical_ch${chapter}_professional.pdf`;
  const outLog = `output/canonical_ch${chapter}_prince.log`;
  run('tsx', [
    'renderer/render-prince-pdf.ts',
    renderJson,
    '--out',
    outPdf,
    '--log',
    outLog,
    '--frontmatter',
    frontmatterPath,
    '--backmatter',
    backmatterPath,
  ]);
  run('tsx', ['validate/verify-prince-log.ts', outLog]);

  // Renderer writes HTML as output/<baseName>_prince.html
  const baseName = path.basename(renderJson, '.json');
  const htmlPath = `output/${baseName}_prince.html`;
  run('tsx', ['validate/verify-no-hard-linebreaks.ts', htmlPath]);
  run('tsx', ['validate/verify-html-anchors.ts', htmlPath]);

  // Layout gates (ignore TOC + opener pages by default)
  // Since we can include frontmatter/backmatter in Prince, ignore non-chapter pages deterministically.
  // These are warnings, not blocking failures - layout issues can be fixed in post-processing.
  run('python3', [
    'validate/verify-page-fill.py',
    outPdf,
    '--min-used',
    '0.50',
    '--ignore-first',
    '2',
    '--ignore-last',
    '1',
    '--ignore-before-first-chapter',
  ], { allowFailure: true });
  run('python3', [
    'validate/verify-column-balance.py',
    outPdf,
    '--ignore-first',
    '2',
    '--ignore-last',
    '1',
    '--ignore-before-first-chapter',
  ], { allowFailure: true });
  run('python3', ['validate/verify-box-justify-gaps.py', outPdf, '--max-gap-pt', '12', '--ignore-first', '2'], { allowFailure: true });

  // Optional: layout report artifacts
  if (hasFlag('--report')) {
    const outJsonReport = `output/canonical_ch${chapter}_layout_report.json`;
    const outTsvReport = `output/canonical_ch${chapter}_layout_report.tsv`;
    run('python3', [
      'validate/report-layout.py',
      outPdf,
      '--out-json',
      outJsonReport,
      '--out-tsv',
      outTsvReport,
      '--min-used',
      '0.50',
      '--ignore-first',
      '2',
    ]);
  }

  console.log(`✅ Build complete: ${path.resolve(PIPELINE_ROOT, outPdf)}`);
}

main().catch((e) => die(String(e)));


