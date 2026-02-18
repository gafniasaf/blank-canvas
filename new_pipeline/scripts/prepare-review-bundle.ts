/**
 * Prepare a self-contained "review bundle" for a whole-book Prince build.
 *
 * What it does:
 * - Runs `npm run build:book -- ... --report` with explicit outputs to a bundle directory
 * - Generates layout reports (JSON + TSV) in the bundle
 * - Runs hyphenation scan (best-effort) and stores results in the bundle
 * - Copies the exact CSS/token artifacts used for rendering
 *
 * Usage:
 *   npm run bundle:review -- --upload <UUID> --rewrites <final_rewrites.json> --figures <figures_by_paragraph_all.json> [--chapters 1,2,...] [--out-dir <dir>]
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const PIPELINE_ROOT = path.resolve(REPO_ROOT, 'new_pipeline');

function tsStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

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

function run(cmd: string, args: string[]) {
  const res = spawnSync(cmd, args, { cwd: PIPELINE_ROOT, stdio: 'inherit', env: process.env });
  if (res.status !== 0) die(`Command failed: ${cmd} ${args.join(' ')}`);
}

function runCapture(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { cwd: PIPELINE_ROOT, encoding: 'utf8', env: process.env });
  return {
    ok: res.status === 0,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
  };
}

function runCaptureRepo(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', env: process.env });
  return {
    ok: res.status === 0,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
  };
}

function parseJsonSafe<T>(raw: string): T | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function copyIfExists(srcAbs: string, destAbs: string) {
  if (!fs.existsSync(srcAbs)) return;
  ensureDir(path.dirname(destAbs));
  fs.copyFileSync(srcAbs, destAbs);
}

function parseChapters(csv: string | null): number[] {
  const raw = String(csv || '').trim();
  if (!raw) return Array.from({ length: 14 }, (_, i) => i + 1);
  return raw
    .split(',')
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function resolveInputPath(label: string, p: string | null): string | null {
  if (!p) return null;
  const s = String(p).trim();
  if (!s) return null;
  if (path.isAbsolute(s)) {
    if (!fs.existsSync(s)) die(`${label} not found: ${s}`);
    return s;
  }
  const repoAbs = path.resolve(REPO_ROOT, s);
  if (fs.existsSync(repoAbs)) return repoAbs;
  const pipeAbs = path.resolve(PIPELINE_ROOT, s);
  if (fs.existsSync(pipeAbs)) return pipeAbs;
  die(`${label} not found (tried repo root + new_pipeline): ${s}`);
}

async function main() {
  const upload = getArg('--upload') || '';
  if (!upload) die('Missing required --upload <UUID>');

  const chapters = parseChapters(getArg('--chapters'));
  const figures = resolveInputPath('Figures mapping', getArg('--figures'));
  const rewrites = resolveInputPath('Rewrites JSON', getArg('--rewrites'));
  const idml = resolveInputPath('IDML snapshot', getArg('--idml') || '_source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml');

  const ignoreFirst = getArg('--ignore-first') || '2';
  const minUsed = getArg('--min-used') || '0.50';

  const fixHyphenation = hasFlag('--fix-hyphenation');
  const fixHyphIters = (() => {
    const v = getArg('--fix-hyphenation-max-iters');
    const n = Number(String(v || '').trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
  })();

  const outDirArg = getArg('--out-dir') || `output/review_bundles/${tsStamp()}`;
  const outDirAbs = path.isAbsolute(outDirArg) ? outDirArg : path.resolve(PIPELINE_ROOT, outDirArg);
  ensureDir(outDirAbs);
  ensureDir(path.join(outDirAbs, 'inputs'));
  ensureDir(path.join(outDirAbs, 'css'));
  ensureDir(path.join(outDirAbs, 'reports'));

  const chaptersCsv = chapters.join(',');

  const outPdf = path.join(outDirAbs, 'book.pdf');
  const outLog = path.join(outDirAbs, 'prince.log');
  const outJsonMerged = path.join(outDirAbs, 'canonical_merged.json');
  const outJsonFinal = path.join(outDirAbs, 'canonical_rewritten.json');

  // Render/build (single source of truth for “what the bundle contains”)
  const buildArgs = [
    'run',
    'build:book',
    '--',
    '--upload',
    upload,
    '--chapters',
    chaptersCsv,
    '--out-pdf',
    outPdf,
    '--out-log',
    outLog,
    '--out-json',
    outJsonMerged,
    '--out-json-final',
    outJsonFinal,
    '--ignore-first',
    ignoreFirst,
    '--min-used',
    minUsed,
    '--report',
  ];
  if (idml) buildArgs.push('--idml', idml);
  if (figures) buildArgs.push('--figures', figures);
  if (rewrites) buildArgs.push('--rewrites', rewrites);

  run('npm', buildArgs);

  // Layout report (bundle-local, stable paths)
  run('python3', [
    'validate/report-layout.py',
    outPdf,
    '--out-json',
    path.join(outDirAbs, 'reports', 'layout_report.json'),
    '--out-tsv',
    path.join(outDirAbs, 'reports', 'layout_report.tsv'),
    '--min-used',
    minUsed,
    '--ignore-first',
    ignoreFirst,
  ]);

  // Hyphenation scan (best-effort; pyphen may not be installed on all machines)
  const scanHyphenation = (): { ok: boolean; invalidCount: number; raw: string } => {
    const hyphJson = runCapture('python3', ['validate/scan-hyphenation.py', outPdf, '--json']);
    if (!hyphJson.ok) {
      fs.writeFileSync(
        path.join(outDirAbs, 'reports', 'hyphenation_scan.error.txt'),
        `scan-hyphenation failed.\n\n${hyphJson.stderr || hyphJson.stdout}`.trim() + '\n',
        'utf8'
      );
      return { ok: false, invalidCount: 0, raw: '' };
    }
    const parsed = parseJsonSafe<{ invalid_count?: number }>(hyphJson.stdout);
    const invalidCount = parsed && typeof parsed.invalid_count === 'number' ? Number(parsed.invalid_count) : 0;
    fs.writeFileSync(path.join(outDirAbs, 'reports', 'hyphenation_scan.json'), hyphJson.stdout, 'utf8');
    return { ok: true, invalidCount, raw: hyphJson.stdout };
  };

  let hyph = scanHyphenation();

  // Optional: auto-fix invalid hyphenations by extending hyphenation_exceptions.json and re-rendering.
  // This is a safe "typesetting polish" (does not change meaning).
  if (fixHyphenation && hyph.ok && hyph.invalidCount > 0) {
    console.log(`🔧 Fix-hyphenation enabled: invalid=${hyph.invalidCount} (maxIters=${fixHyphIters})`);

    const exceptionsPath = path.resolve(REPO_ROOT, 'new_pipeline/templates/hyphenation_exceptions.json');
    for (let i = 1; i <= fixHyphIters; i++) {
      console.log(`🔧 Hyphenation fix iter ${i}/${fixHyphIters} ...`);

      // Update exceptions deterministically (no LLM needed)
      run('tsx', [
        'fix/llm-fix-hyphenation.ts',
        '--pdf',
        outPdf,
        '--exceptions',
        exceptionsPath,
        '--no-llm',
      ]);

      // Re-render only (fast): canonical JSON already exists in the bundle, and only WORD JOINER insertion changed.
      run('tsx', ['renderer/render-prince-pdf.ts', outJsonFinal, '--out', outPdf, '--log', outLog]);
      run('tsx', ['validate/verify-prince-log.ts', outLog]);

      const baseName = path.basename(outJsonFinal, '.json');
      const htmlPath = path.resolve(PIPELINE_ROOT, 'output', `${baseName}_prince.html`);
      run('tsx', ['validate/verify-no-hard-linebreaks.ts', htmlPath]);
      run('tsx', ['validate/verify-html-anchors.ts', htmlPath]);
      run('python3', ['validate/verify-no-heading-hyphenation.py', outPdf]);
      run('python3', ['validate/verify-bullet-orphan-split.py', outPdf, '--ignore-first', ignoreFirst, '--ignore-last', '1']);

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

      run('python3', [
        'validate/report-layout.py',
        outPdf,
        '--out-json',
        path.join(outDirAbs, 'reports', 'layout_report.json'),
        '--out-tsv',
        path.join(outDirAbs, 'reports', 'layout_report.tsv'),
        '--min-used',
        minUsed,
        '--ignore-first',
        ignoreFirst,
      ]);

      hyph = scanHyphenation();
      if (!hyph.ok) break;
      if (hyph.invalidCount <= 0) {
        console.log('✅ Hyphenation fix converged (invalid_count=0)');
        break;
      }
    }
  }

  // Copy rendered HTML produced by the renderer (it is always written under new_pipeline/output/)
  const baseName = path.basename(outJsonFinal, '.json');
  const htmlSrc = path.resolve(PIPELINE_ROOT, 'output', `${baseName}_prince.html`);
  copyIfExists(htmlSrc, path.join(outDirAbs, 'book.html'));

  // Copy CSS/token artifacts (exact inputs used by renderer)
  copyIfExists(path.resolve(PIPELINE_ROOT, 'templates', 'prince-af-two-column.css'), path.join(outDirAbs, 'css', 'prince-af-two-column.css'));
  copyIfExists(
    path.resolve(PIPELINE_ROOT, 'templates', 'prince-af-two-column.tokens.css'),
    path.join(outDirAbs, 'css', 'prince-af-two-column.tokens.css')
  );
  copyIfExists(path.resolve(PIPELINE_ROOT, 'extract', 'design_tokens.json'), path.join(outDirAbs, 'css', 'design_tokens.json'));

  // Copy key inputs for reproducibility
  if (rewrites) copyIfExists(rewrites, path.join(outDirAbs, 'inputs', 'rewrites.json'));
  if (figures) copyIfExists(figures, path.join(outDirAbs, 'inputs', 'figures_by_paragraph_all.json'));
  if (idml) copyIfExists(idml, path.join(outDirAbs, 'inputs', path.basename(idml)));
  copyIfExists(path.resolve(REPO_ROOT, 'books', 'manifest.json'), path.join(outDirAbs, 'inputs', 'books_manifest.json'));
  copyIfExists(path.resolve(REPO_ROOT, 'docs', 'PRINCE_LAYOUT_RULES.md'), path.join(outDirAbs, 'inputs', 'PRINCE_LAYOUT_RULES.md'));
  copyIfExists(path.resolve(PIPELINE_ROOT, 'templates', 'hyphenation_exceptions.json'), path.join(outDirAbs, 'inputs', 'hyphenation_exceptions.json'));

  // Text review artifacts (best-effort):
  // - Deterministic lint report over rewrites.json
  // - Deterministic approval sample markdown (for human/agent "final" approval)
  const rewritesInBundle = path.join(outDirAbs, 'inputs', 'rewrites.json');
  const textLintReport = path.join(outDirAbs, 'reports', 'text_lint_report.json');
  const textLintError = path.join(outDirAbs, 'reports', 'text_lint.error.txt');
  const textApprovalSample = path.join(outDirAbs, 'reports', 'text_approval_sample.md');
  const textApprovalError = path.join(outDirAbs, 'reports', 'text_approval_sample.error.txt');

  if (rewrites && fs.existsSync(rewritesInBundle)) {
    const lintRes = runCaptureRepo('npm', ['run', 'lint:text', '--', rewritesInBundle, '--output', textLintReport]);
    if (!lintRes.ok) {
      fs.writeFileSync(
        textLintError,
        `lint:text failed (non-fatal for bundle).\n\nSTDOUT:\n${lintRes.stdout}\n\nSTDERR:\n${lintRes.stderr}`.trim() + '\n',
        'utf8'
      );
    }

    if (fs.existsSync(textLintReport)) {
      const sampleRes = runCaptureRepo('npm', [
        'run',
        'report:text:approval-sample',
        '--',
        '--rewrites',
        rewritesInBundle,
        '--lint',
        textLintReport,
        '--out',
        textApprovalSample,
      ]);
      if (!sampleRes.ok) {
        fs.writeFileSync(
          textApprovalError,
          `text approval sample generation failed (non-fatal for bundle).\n\nSTDOUT:\n${sampleRes.stdout}\n\nSTDERR:\n${sampleRes.stderr}`.trim() +
            '\n',
          'utf8'
        );
      }
    }
  }

  const manifest = {
    created_at: new Date().toISOString(),
    upload,
    chapters,
    min_used: minUsed,
    ignore_first: ignoreFirst,
    inputs: {
      rewrites: rewrites || '',
      figures: figures || '',
      idml: idml || '',
    },
    outputs: {
      pdf: outPdf,
      prince_log: outLog,
      canonical_merged: outJsonMerged,
      canonical_rewritten: outJsonFinal,
      html: fs.existsSync(path.join(outDirAbs, 'book.html')) ? path.join(outDirAbs, 'book.html') : '',
      reports: {
        layout_json: path.join(outDirAbs, 'reports', 'layout_report.json'),
        layout_tsv: path.join(outDirAbs, 'reports', 'layout_report.tsv'),
        hyphenation_json: fs.existsSync(path.join(outDirAbs, 'reports', 'hyphenation_scan.json'))
          ? path.join(outDirAbs, 'reports', 'hyphenation_scan.json')
          : '',
        hyphenation_error: fs.existsSync(path.join(outDirAbs, 'reports', 'hyphenation_scan.error.txt'))
          ? path.join(outDirAbs, 'reports', 'hyphenation_scan.error.txt')
          : '',
        text_lint_json: fs.existsSync(textLintReport) ? textLintReport : '',
        text_lint_error: fs.existsSync(textLintError) ? textLintError : '',
        text_approval_sample_md: fs.existsSync(textApprovalSample) ? textApprovalSample : '',
        text_approval_sample_error: fs.existsSync(textApprovalError) ? textApprovalError : '',
      },
    },
  };
  fs.writeFileSync(path.join(outDirAbs, 'bundle_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const readme = `# Prince review bundle

This folder is a self-contained snapshot for reviewing a whole-book Prince build.

## Primary artifacts
- **PDF**: \`book.pdf\`
- **Prince log**: \`prince.log\`
- **Layout report**: \`reports/layout_report.json\` + \`reports/layout_report.tsv\`
- **Hyphenation scan**: \`reports/hyphenation_scan.json\` (or \`reports/hyphenation_scan.error.txt\`)
- **Text lint report**: \`reports/text_lint_report.json\` (best-effort)
- **Text approval sample**: \`reports/text_approval_sample.md\` (best-effort)

## Repro inputs
- \`inputs/rewrites.json\` (if provided)
- \`inputs/figures_by_paragraph_all.json\` (if provided)
- \`css/prince-af-two-column.tokens.css\` (token CSS actually used)

Generated at: ${manifest.created_at}
`;
  fs.writeFileSync(path.join(outDirAbs, 'README.md'), readme, 'utf8');

  console.log(`✅ Review bundle ready: ${outDirAbs}`);
}

main().catch((e) => die(String(e?.message || e)));


