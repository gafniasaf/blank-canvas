/**
 * JSON-first whole-book orchestrator (NO InDesign runs).
 *
 * Purpose:
 * - Drive the LLM rewrite pipeline chapter-by-chapter while keeping ALL deterministic guardrails.
 * - Produce a single merged rewrites JSON suitable for later InDesign apply.
 *
 * This script is meant to operationalize:
 * - docs/JSON_FIRST_WORKFLOW_FOR_LLM_AGENT.md
 * - docs/SYSTEM_OVERVIEW_FOR_LLM_REWRITE_AGENT.md
 *
 * What it does (default):
 * - Uses books/manifest.json to determine book + chapters + canonical IDML snapshot
 * - Makes a working copy of the input JSON
 * - For each chapter:
 *   - Runs LLM iterate (scoped to chapter) using scripts/llm-iterate-rewrites-json.ts
 *   - Runs deterministic fix-ups (scripts/fix-rewrites-json-for-indesign.ts)
 *   - Runs deterministic preflight lint (scripts/preflight-rewrites-json.ts)
 * - Runs the N4 numbering gate once at the end
 *
 * Usage:
 *   npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE
 *
 * Options:
 *   --book <book_id>                 Required (must exist in books/manifest.json)
 *   --chapters "1,2,3"               Optional. If omitted, uses manifest entry's chapters list.
 *   --in <path>                      Optional. Default: ~/Desktop/rewrites_for_indesign.json
 *   --out <path>                     Optional. Default: output/json_first/<book>/<runId>/rewrites_for_indesign.<book>.FINAL.json
 *   --out-dir <dir>                  Optional. Default: output/json_first/<book>/<runId>/
 *   --jobs <N>                       Optional. Parallelize per-chapter LLM steps with a worker pool (recommended: 2–4). Default: 1 (sequential).
 *   --jobs-unsafe                     Optional. Allow --jobs > 4 (may be throttled/unstable depending on provider quotas).
 *   --review                          Optional. Also run LLM review pass per chapter (scripts/llm-review-rewrites-json.ts)
 *   --promote                         Optional. Promote final JSON to ~/Desktop/rewrites_for_indesign.json (with backup)
 *   --dry-run                         Optional. Print commands without executing
 *
 * Pass-through:
 * - Any additional flags are forwarded to BOTH iterate + review steps (safe: unknown flags are ignored).
 *
 * Examples:
 *   npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE --chapters 1,2 --write-all --max-iters 5 --target-score 100 --model claude-haiku-4-5-20251001
 *   npm run build:book:json-first -- --book MBO_AF4_2024_COMMON_CORE --review --sample-pages 2 --words-per-page 550
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

import dotenv from 'dotenv';

// Load env in local-dev friendly order:
// - .env.local (not committed) FIRST
// - .env (default) SECOND
//
// Rationale:
// - .env.local should override .env defaults/placeholders
// - but neither should override real env vars already set in the shell/CI.
try {
  const localPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(localPath)) dotenv.config({ path: localPath });
} catch {
  // ignore
}
dotenv.config();

type Manifest = {
  version: number;
  books: Array<{
    book_id: string;
    canonical_n4_idml_path?: string;
    chapters?: number[];
    upload_id?: string;
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

function replaceOrAppendFlag(args: string[], flag: string, value: string): string[] {
  const out = [...args];
  const idx = out.findIndex((x) => x === flag);
  if (idx >= 0) {
    // Replace existing value if present; otherwise append value
    if (idx + 1 < out.length && !String(out[idx + 1]).startsWith('--')) out[idx + 1] = value;
    else out.splice(idx + 1, 0, value);
    return out;
  }
  out.push(flag, value);
  return out;
}

function parseChapters(s: string): number[] {
  return String(s || '')
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function isoRunId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function run(cmd: string, args: string[], opts: { cwd?: string; dryRun?: boolean } = {}) {
  const shown = [cmd, ...args].join(' ');
  console.log(`$ ${shown}`);
  if (opts.dryRun) return;
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd || process.cwd(), env: process.env });
  if (r.status !== 0) {
    throw new Error(`Command failed (${r.status}): ${shown}`);
  }
}

function runAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; dryRun?: boolean; logPath?: string; label?: string } = {}
): Promise<void> {
  const shown = [cmd, ...args].join(' ');
  const label = opts.label ? String(opts.label) : '';
  const prefix = label ? `[${label}] ` : '';
  console.log(`${prefix}$ ${shown}`);
  if (opts.dryRun) return Promise.resolve();

  const cwd = opts.cwd || process.cwd();
  const env = process.env;

  let logStream: fs.WriteStream | null = null;
  try {
    if (opts.logPath) {
      ensureDir(path.dirname(opts.logPath));
      logStream = fs.createWriteStream(opts.logPath, { flags: 'w' });
    }
  } catch {
    // ignore log failures; fall back to console
    logStream = null;
  }

  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

  const writeLine = (s: string) => {
    if (logStream) logStream.write(s);
    else process.stdout.write(s);
  };
  const writeErr = (s: string) => {
    if (logStream) logStream.write(s);
    else process.stderr.write(s);
  };

  child.stdout?.on('data', (d) => writeLine(String(d)));
  child.stderr?.on('data', (d) => writeErr(String(d)));

  return new Promise((resolve, reject) => {
    child.on('error', (e) => {
      try {
        if (logStream) logStream.end();
      } catch {
        // ignore
      }
      reject(e);
    });
    child.on('close', (code) => {
      try {
        if (logStream) logStream.end();
      } catch {
        // ignore
      }
      if (code !== 0) {
        reject(new Error(`Command failed (${code}): ${shown}${opts.logPath ? ` (see ${opts.logPath})` : ''}`));
      } else {
        resolve();
      }
    });
  });
}

function pickPassThroughArgs(argv: string[]): string[] {
  // Remove our own orchestrator flags so they don't leak into child scripts.
  // We keep any other flags (e.g. --model, --max-iters, --write-all, etc) as pass-through.
  const consumedKeys = new Set([
    'book',
    'profile',
    'chapters',
    'in',
    'out',
    'out-dir',
    'jobs',
    'jobs-unsafe',
    'seed',
    'quality-sweep',
    'quality-sweep-max-iters',
    'no-quality-sweep',
    'text-gate',
    'text-gate-orphan-warn-threshold',
    'review',
    'resume',
    'promote',
    'dry-run',
  ]);

  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (consumedKeys.has(key)) {
      const next = argv[i + 1];
      if (next && !next.startsWith('--') && key !== 'review' && key !== 'promote' && key !== 'dry-run') i++;
      continue;
    }
    out.push(a);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out.push(next);
      i++;
    }
  }
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function resolveRepoPath(p: string): string {
  const repoRoot = path.resolve(__dirname, '..');
  const expanded = expandTilde(String(p || '').trim());
  if (!expanded) return expanded;
  if (path.isAbsolute(expanded)) return expanded;
  if (expanded.startsWith('./')) return path.resolve(repoRoot, expanded);
  return path.resolve(repoRoot, expanded);
}

function mustHaveOpenAiKey() {
  const apiKey = String(process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) throw new Error('❌ Missing OPENAI_API_KEY (required for provider=openai).');
  if (apiKey === 'your-openai-key') {
    throw new Error(
      `❌ OPENAI_API_KEY is still set to the placeholder value 'your-openai-key'.\n` +
        `Set a real key in your shell (recommended: export OPENAI_API_KEY=...) or update .env.local, then rerun.`
    );
  }
}

function mustHaveAnthropicKey() {
  const apiKey = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!apiKey) throw new Error('❌ Missing ANTHROPIC_API_KEY (required for provider=anthropic).');
  // We don't enforce a specific placeholder string here; just require non-empty.
}

function inferLlmProvidersNeeded(opts: { passThroughArgs: string[]; doReview: boolean }): { openai: boolean; anthropic: boolean } {
  const args = opts.passThroughArgs || [];
  const take = (flag: string): string | null => {
    const idx = args.findIndex((x) => x === flag);
    if (idx < 0) return null;
    const v = args[idx + 1];
    if (!v || String(v).startsWith('--')) return null;
    return String(v).trim().toLowerCase();
  };

  const specified: string[] = [];
  for (const f of ['--provider', '--write-provider', '--check-provider', '--repair-provider'] as const) {
    const v = take(f);
    if (v) specified.push(v);
  }

  // Review step uses OpenAI-only implementation today.
  const openaiFromReview = !!opts.doReview;

  // Defaults:
  // - iterate:json default is Anthropic in this repo (see scripts/llm-iterate-rewrites-json.ts defaults)
  if (specified.length === 0) {
    return { openai: openaiFromReview, anthropic: true };
  }

  const openai = openaiFromReview || specified.includes('openai');
  const anthropic = specified.includes('anthropic');
  return { openai, anthropic };
}

type RewritesJson = {
  paragraphs: Array<Record<string, any>>;
  [k: string]: any;
};

function loadRewritesJson(p: string): RewritesJson {
  const raw = fs.readFileSync(p, 'utf8');
  const j = JSON.parse(raw) as RewritesJson;
  if (!j || typeof j !== 'object' || !Array.isArray((j as any).paragraphs)) {
    throw new Error(`Invalid rewrites JSON (missing paragraphs array): ${p}`);
  }
  return j;
}

type TextLintReport = {
  input_file?: string;
  chapter_filter?: string | null;
  timestamp?: string;
  total_paragraphs?: number;
  summary?: {
    errors: number;
    warnings: number;
    by_rule: Record<string, number>;
  };
};

function parseProfile(raw: unknown): 'production' | 'draft' {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return 'production'; // default
  if (v === 'prod' || v === 'production' || v === 'strict' || v === 'quality') return 'production';
  if (v === 'draft' || v === 'fast' || v === 'dev') return 'draft';
  // Unknown profile => default to production (safer)
  return 'production';
}

function ensureFlag(args: string[], flag: string): string[] {
  return args.includes(flag) ? args : [...args, flag];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function getFlagValue(args: string[], flag: string): string | null {
  const idx = args.findIndex((x) => x === flag);
  if (idx < 0) return null;
  const v = args[idx + 1];
  if (!v || String(v).startsWith('--')) return null;
  return String(v);
}

function runTextLintChapter(opts: {
  inJson: string;
  chapter: number;
  outDir: string;
  label: string;
  dryRun: boolean;
}): { ch: number; reportPath: string; exitCode: number; summary: TextLintReport['summary'] | null } {
  const ch = opts.chapter;
  const reportPath = path.join(opts.outDir, `ch${pad2(ch)}.lint.${opts.label}.json`);
  const args = ['run', 'lint:text', '--', opts.inJson, '--chapter', String(ch), '--output', reportPath];
  const shown = ['npm', ...args].join(' ');
  console.log(`$ ${shown}`);
  if (opts.dryRun) return { ch, reportPath, exitCode: 0, summary: null };

  const r = spawnSync('npm', args, { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exitCode = Number(r.status ?? 0);
  let summary: TextLintReport['summary'] | null = null;
  try {
    if (fs.existsSync(reportPath)) {
      const rep = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as TextLintReport;
      if (rep && rep.summary && typeof rep.summary.errors === 'number' && typeof rep.summary.warnings === 'number') summary = rep.summary;
    }
  } catch {
    // ignore
  }

  const errs = summary?.errors ?? (exitCode !== 0 ? 1 : 0);
  const warns = summary?.warnings ?? 0;
  console.log(`[lint:text] ch${pad2(ch)} errors=${errs} warnings=${warns} report=${reportPath}`);
  if (exitCode !== 0 && (!summary || errs === 0)) {
    // Surface the underlying CLI output when the report wasn't usable.
    const out = `${String(r.stdout || '')}\n${String(r.stderr || '')}`.trim();
    if (out) console.log(out);
  }
  return { ch, reportPath, exitCode, summary };
}

function runTextGate(opts: {
  inJson: string;
  chapters: number[];
  outDir: string;
  label: string;
  dryRun: boolean;
  orphanWarnThreshold: number; // treat ORPHAN_CONTINUATION warnings >= threshold as failing
}): {
  results: Array<{ ch: number; reportPath: string; summary: TextLintReport['summary'] | null }>;
  failingChapters: number[];
} {
  const results: Array<{ ch: number; reportPath: string; summary: TextLintReport['summary'] | null }> = [];
  const failing = new Set<number>();

  for (const ch of opts.chapters) {
    const r = runTextLintChapter({ inJson: opts.inJson, chapter: ch, outDir: opts.outDir, label: opts.label, dryRun: opts.dryRun });
    results.push({ ch: r.ch, reportPath: r.reportPath, summary: r.summary });

    const errors = r.summary?.errors ?? (r.exitCode !== 0 ? 1 : 0);
    if (errors > 0) failing.add(ch);

    const orphanWarns = Number(r.summary?.by_rule?.ORPHAN_CONTINUATION ?? 0);
    if (opts.orphanWarnThreshold > 0 && orphanWarns >= opts.orphanWarnThreshold) failing.add(ch);
  }

  return { results, failingChapters: Array.from(failing.values()).sort((a, b) => a - b) };
}

function getCriticalIssuesSummaryFromIteratedJson(pth: string): {
  finalScore: number | null;
  criticalIssuesTotal: number;
  criticalSections: number;
  detErrors: number;
  llmMinScore: number | null;
} {
  const j: any = loadRewritesJson(pth) as any;
  const finalScoreRaw = Number(j?.llm_iterated_final_score);
  const finalScore = Number.isFinite(finalScoreRaw) ? finalScoreRaw : null;

  const rep = j?.llm_iterated_report;
  const pick = (() => {
    if (rep && typeof rep === 'object') {
      if (rep.post_repair_check && typeof rep.post_repair_check === 'object') return rep.post_repair_check;
      const iters = Array.isArray(rep.iterations) ? rep.iterations : [];
      if (iters.length) return iters[iters.length - 1];
    }
    return null;
  })();

  const criticalIssuesTotal = Math.max(0, Math.floor(Number(pick?.critical_issues_total ?? 0) || 0));
  const criticalSections = Math.max(0, Math.floor(Number(pick?.sections_with_critical_issues ?? 0) || 0));
  const detErrors = Math.max(0, Math.floor(Number(pick?.deterministic_errors ?? 0) || 0));
  const llmMinScoreRaw = Number(pick?.llm_min_score);
  const llmMinScore = Number.isFinite(llmMinScoreRaw) ? llmMinScoreRaw : null;
  return { finalScore, criticalIssuesTotal, criticalSections, detErrors, llmMinScore };
}

function mergeChapterOutputs(opts: {
  basePath: string;
  outPath: string;
  chapters: number[];
  chapterJsonPaths: Map<number, string>;
  jobs: number;
}): { updated: number; missing: number } {
  const base = loadRewritesJson(opts.basePath);
  const paras = base.paragraphs;
  const idxById = new Map<string, number>();
  for (let i = 0; i < paras.length; i++) {
    const id = String((paras[i] as any).paragraph_id || '').trim();
    if (id) idxById.set(id, i);
  }

  let updated = 0;
  let missing = 0;

  for (const ch of opts.chapters) {
    const pth = opts.chapterJsonPaths.get(ch);
    if (!pth) throw new Error(`Missing chapter output path for chapter ${ch}`);
    const j = loadRewritesJson(pth);
    for (const p of j.paragraphs) {
      if (String((p as any).chapter || '').trim() !== String(ch)) continue;
      const id = String((p as any).paragraph_id || '').trim();
      if (!id) continue;
      const idx = idxById.get(id);
      if (idx === undefined) {
        missing++;
        continue;
      }
      // Merge entire paragraph object to preserve any per-paragraph metadata produced by the LLM pipeline.
      paras[idx] = { ...(paras[idx] as any), ...(p as any) };
      updated++;
    }
  }

  // Add lightweight provenance (safe: ignored by downstream scripts)
  base.llm_parallel = {
    jobs: opts.jobs,
    chapters: opts.chapters.map(String),
    merged_at: new Date().toISOString(),
  };

  fs.writeFileSync(opts.outPath, JSON.stringify(base, null, 2));
  return { updated, missing };
}

async function runChapterPool(opts: {
  chapters: number[];
  jobs: number;
  makeArgs: (ch: number) => { cmd: string; args: string[]; logPath?: string; outPath?: string };
  dryRun: boolean;
}): Promise<void> {
  const queue = [...opts.chapters];
  const running: ChildProcess[] = [];
  let firstErr: any = null;

  const runOne = async (ch: number) => {
    const { cmd, args, logPath, outPath } = opts.makeArgs(ch);
    await runAsync(cmd, args, { dryRun: opts.dryRun, logPath, label: `ch${String(ch).padStart(2, '0')}` });
    if (outPath && !opts.dryRun && !fs.existsSync(outPath)) {
      throw new Error(`Expected output file not found for chapter ${ch}: ${outPath}`);
    }
  };

  const worker = async () => {
    while (queue.length && !firstErr) {
      const ch = queue.shift()!;
      try {
        await runOne(ch);
      } catch (e) {
        firstErr = e;
        // Best-effort: terminate any children we spawned in this pool run.
        for (const p of running) {
          try {
            p.kill('SIGTERM');
          } catch {
            // ignore
          }
        }
        break;
      }
    }
  };

  // NOTE: We don't keep ChildProcess handles from runAsync; this array is kept for future-proofing
  // (in case we later want explicit cancellation with tracked processes). For now, we rely on the
  // firstErr flag to stop launching additional work.
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < Math.max(1, opts.jobs); i++) workers.push(worker());
  await Promise.all(workers);
  if (firstErr) throw firstErr;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bookId = String(args.book || '').trim();
  if (!bookId) {
    console.error(
      'Usage: npm run build:book:json-first -- --book <book_id> [--profile production|draft] [--chapters 1,2,3] [--jobs N] [--resume] [--quality-sweep] [--no-quality-sweep] [--quality-sweep-max-iters N] [--text-gate] [--text-gate-orphan-warn-threshold N] [--in path] [--out path] [--review] [--promote] [--dry-run]'
    );
    process.exit(1);
  }

  const dryRun = args['dry-run'] === true;
  const profile = parseProfile((args as any).profile);
  const doReview = args.review === true;
  const doPromote = args.promote === true;
  const resume = args.resume === true;
  const doQualitySweepFlag = args['quality-sweep'] === true;
  const noQualitySweep = (args as any)['no-quality-sweep'] === true;
  const doQualitySweep = !noQualitySweep && (doQualitySweepFlag || profile === 'production');
  const qualitySweepMaxItersRaw =
    typeof (args as any)['quality-sweep-max-iters'] === 'string'
      ? parseInt(String((args as any)['quality-sweep-max-iters']), 10)
      : profile === 'production'
        ? 8
        : 6;
  const qualitySweepMaxIters = Number.isFinite(qualitySweepMaxItersRaw) && qualitySweepMaxItersRaw > 0 ? qualitySweepMaxItersRaw : 6;
  const jobsRaw = typeof (args as any).jobs === 'string' ? parseInt(String((args as any).jobs), 10) : 1;
  const jobsUnsafe = (args as any)['jobs-unsafe'] === true;
  const jobsRequested = Number.isFinite(jobsRaw) && jobsRaw > 0 ? jobsRaw : 1;
  const jobs = jobsUnsafe ? jobsRequested : Math.min(jobsRequested, 4);
  if (jobsRequested > jobs) {
    console.warn(`⚠️  --jobs ${jobsRequested} capped to ${jobs} (recommended 2–4). Use --jobs-unsafe to override.`);
  }
  const passThroughRaw = pickPassThroughArgs(process.argv.slice(2));

  // Profile defaults (affects child scripts via pass-through flags)
  let passThroughProfiled = [...passThroughRaw];
  if (profile === 'production') {
    // Default mode to prince if not explicitly provided
    if (!hasFlag(passThroughProfiled, '--mode')) passThroughProfiled = [...passThroughProfiled, '--mode', 'prince'];
    // Bullet hygiene: force bullet-style paragraphs to become short phrases OR be rewritten as prose (no semicolons).
    passThroughProfiled = ensureFlag(passThroughProfiled, '--enforce-bullet-short');
    if (!hasFlag(passThroughProfiled, '--bullet-max-words')) passThroughProfiled = [...passThroughProfiled, '--bullet-max-words', '12'];
  }

  // Default behavior: actually rewrite.
  // If the caller did not specify any write mode, default to --write-if-unchanged.
  // - With seed=approved: only rewrite paragraphs that are still unchanged (likely missing work)
  // - With seed=original: rewrite everything (since everything is unchanged)
  const hasWriteMode =
    passThroughProfiled.includes('--write-all') ||
    passThroughProfiled.includes('--write-missing') ||
    passThroughProfiled.includes('--write-if-unchanged');
  const passThrough = hasWriteMode ? passThroughProfiled : [...passThroughProfiled, '--write-if-unchanged'];
  const passThroughQualitySweep = replaceOrAppendFlag(passThrough, '--max-iters', String(qualitySweepMaxIters));

  // Keep mode consistent across iterate/fix/preflight/review/promote.
  // We only forward --mode <value> (not all passThrough flags) to scripts that don't care about other LLM params.
  const modeArgs = (() => {
    const idx = passThroughProfiled.findIndex((x) => x === '--mode');
    const val = idx >= 0 && idx + 1 < passThroughProfiled.length ? String(passThroughProfiled[idx + 1] ?? '').trim() : '';
    if (!val || val.startsWith('--')) return [] as string[];
    return ['--mode', val] as string[];
  })();

  // Text gate (production): run deterministic text lint and treat lint errors as must-fix.
  // We also treat ORPHAN_CONTINUATION as must-fix when it exceeds a small threshold (default 2),
  // because it typically indicates broken sentence flow between paragraphs.
  const textGateEnabled = profile === 'production' && !dryRun;
  const orphanWarnThresholdRaw =
    typeof (args as any)['text-gate-orphan-warn-threshold'] === 'string' ? String((args as any)['text-gate-orphan-warn-threshold']) : '';
  const orphanWarnThreshold = Math.max(0, parseInt(orphanWarnThresholdRaw || '', 10) || 2);

  console.log(`\n=== PROFILE: ${profile} ===`);
  console.log(`mode=${getFlagValue(passThroughProfiled, '--mode') || 'prince'} quality_sweep=${doQualitySweep ? 'on' : 'off'} qs_max_iters=${qualitySweepMaxIters}`);
  if (profile === 'production') {
    console.log(
      `iterate defaults: enforce_bullet_short=${hasFlag(passThroughProfiled, '--enforce-bullet-short') ? 'on' : 'off'} ` +
        `bullet_max_words=${getFlagValue(passThroughProfiled, '--bullet-max-words') || '12'}`
    );
    console.log(`text_gate=${textGateEnabled ? 'on' : 'off'} orphan_warn_threshold=${orphanWarnThreshold}`);
  }

  // Load manifest
  const manifestPath = path.resolve(__dirname, '..', 'books', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  const book = manifest.books.find((b) => b.book_id === bookId);
  if (!book) throw new Error(`❌ Book not found in books/manifest.json: ${bookId}`);

  const chapters = typeof args.chapters === 'string' ? parseChapters(String(args.chapters)) : (book.chapters || []);
  if (!chapters.length) {
    throw new Error(
      `❌ No chapters provided and manifest entry has no chapters list for ${bookId}.\n` +
        `Update books/manifest.json (preferred) or pass --chapters "1,2,3".`
    );
  }

  const idmlRel = String(book.canonical_n4_idml_path || '').trim();
  if (!idmlRel) throw new Error(`❌ Missing canonical_n4_idml_path in manifest for ${bookId}`);
  const idmlPath = resolveRepoPath(idmlRel);
  if (!fs.existsSync(idmlPath)) throw new Error(`❌ IDML not found: ${idmlPath}`);

  const home = process.env.HOME || '';
  const inPathArg = typeof args.in === 'string' ? String(args.in) : '';
  const inPath = inPathArg ? resolveRepoPath(inPathArg) : '';

  const runId = isoRunId();
  const defaultOutDir = path.resolve(__dirname, '..', 'output', 'json_first', bookId, runId);
  const outDir = resolveRepoPath(typeof args['out-dir'] === 'string' ? String(args['out-dir']) : defaultOutDir);
  ensureDir(outDir);

  const finalOut = resolveRepoPath(
    typeof args.out === 'string' ? String(args.out) : path.join(outDir, `rewrites_for_indesign.${bookId}.FINAL.json`)
  );

  // LLM steps require provider keys (skip in dry-run mode so you can sanity-check wiring without secrets)
  if (!dryRun) {
    const needs = inferLlmProvidersNeeded({ passThroughArgs: passThrough, doReview });
    if (needs.openai) mustHaveOpenAiKey();
    if (needs.anthropic) mustHaveAnthropicKey();
  }

  // Run unit guardrail tests once at start (fast, stable)
  run('npm', ['test'], { dryRun });

  // Start from a working copy so we don't mutate the user's Desktop file while iterating.
  // If --in was not provided, export from DB (manifest.upload_id or --upload) into 00_input.json.
  const workingStart = path.join(outDir, '00_input.json');

  const uploadId = typeof (args as any).upload === 'string' ? String((args as any).upload).trim() : String(book.upload_id || '').trim();
  const seed = typeof (args as any).seed === 'string' ? String((args as any).seed).trim().toLowerCase() : 'approved';
  const exportSeed = seed === 'original' ? 'original' : 'approved';

  if (inPath) {
    if (!fs.existsSync(inPath)) throw new Error(`❌ Input JSON not found: ${inPath}`);
    if (!dryRun) fs.copyFileSync(inPath, workingStart);
  } else {
    if (!uploadId) {
      throw new Error(
        `❌ No input JSON provided and no upload_id found.\n` +
          `Provide --in <path> OR set books/manifest.json.books[].upload_id OR pass --upload <UUID>.`
      );
    }
    const chaptersCsv = chapters.join(',');
    run(
      'npx',
      [
        'ts-node',
        'scripts/export-rewrites-json-from-db.ts',
        uploadId,
        '--out',
        workingStart,
        '--chapters',
        chaptersCsv,
        '--seed',
        exportSeed,
      ],
      { dryRun }
    );
  }
  let current = workingStart;
  const iterOutPaths = new Map<number, string>();

  // Optional: ensure numbering contract is already valid before spending LLM tokens
  run('python3', ['scripts/verify-json-numbering-vs-n4.py', '--json', current, '--idml', idmlPath, '--require-subfield', 'true'], {
    dryRun,
  });

  if (jobs <= 1) {
    for (const ch of chapters) {
      console.log(`\n=== JSON-FIRST BOOK ${bookId} :: CHAPTER ${ch} ===`);

      // 1) Iterate (LLM write/check/repair), scoped to chapter
      const iterOut = path.join(outDir, `ch${String(ch).padStart(2, '0')}.iterated.json`);
      iterOutPaths.set(ch, iterOut);
      if (resume && !dryRun && fs.existsSync(iterOut) && fs.statSync(iterOut).size > 50) {
        console.log(`[ch${String(ch).padStart(2, '0')}] (resume) using existing iterated output: ${iterOut}`);
      } else {
        run('npm', ['run', 'iterate:json', '--', current, iterOut, '--chapter', String(ch), ...passThrough], { dryRun });
      }
      current = iterOut;

      // 2) Deterministic fixes (safe-only)
      const fixedOut = path.join(outDir, `ch${String(ch).padStart(2, '0')}.fixed.json`);
      run('npm', ['run', 'fix:json', '--', current, fixedOut, ...modeArgs], { dryRun });
      current = fixedOut;

      // 3) Deterministic preflight lint (no InDesign)
      run('ts-node', ['scripts/preflight-rewrites-json.ts', current, ...modeArgs], { dryRun });

      // 4) Optional reviewer pass (layer block placement sanity)
      if (doReview) {
        const reviewedOut = path.join(outDir, `ch${String(ch).padStart(2, '0')}.reviewed.json`);
        run('npm', ['run', 'review:json', '--', current, reviewedOut, '--chapter', String(ch), ...passThrough], { dryRun });
        current = reviewedOut;

        const fixedAfterReview = path.join(outDir, `ch${String(ch).padStart(2, '0')}.reviewed.fixed.json`);
        run('npm', ['run', 'fix:json', '--', current, fixedAfterReview, ...modeArgs], { dryRun });
        current = fixedAfterReview;

        run('ts-node', ['scripts/preflight-rewrites-json.ts', current, ...modeArgs], { dryRun });
      }
    }
  } else {
    console.log(`\n=== JSON-FIRST BOOK ${bookId} :: PARALLEL ITERATE (jobs=${jobs}) ===`);
    const iterPaths = new Map<number, string>();
    const toRun: number[] = [];
    for (const ch of chapters) {
      const iterOut = path.join(outDir, `ch${String(ch).padStart(2, '0')}.iterated.json`);
      iterPaths.set(ch, iterOut);
      iterOutPaths.set(ch, iterOut);
      if (resume && !dryRun && fs.existsSync(iterOut) && fs.statSync(iterOut).size > 50) {
        console.log(`[ch${String(ch).padStart(2, '0')}] (resume) using existing iterated output: ${iterOut}`);
      } else {
        toRun.push(ch);
      }
    }
    await runChapterPool({
      chapters: toRun,
      jobs,
      dryRun,
      makeArgs: (ch: number) => {
        const iterOut = path.join(outDir, `ch${String(ch).padStart(2, '0')}.iterated.json`);
        const logPath = path.join(outDir, `ch${String(ch).padStart(2, '0')}.iterate.log`);
        return {
          cmd: 'npm',
          args: ['run', 'iterate:json', '--', current, iterOut, '--chapter', String(ch), ...passThrough],
          logPath,
          outPath: iterOut,
        };
      },
    });

    const mergedIter = path.join(outDir, `00_parallel.iterated.merged.json`);
    if (!dryRun) {
      const m1 = mergeChapterOutputs({ basePath: current, outPath: mergedIter, chapters, chapterJsonPaths: iterPaths, jobs });
      console.log(`Merged parallel iterate outputs → ${mergedIter} (updated=${m1.updated}, missing=${m1.missing})`);
    } else {
      console.log(`(dry-run) Would merge per-chapter iterate outputs → ${mergedIter}`);
    }
    current = mergedIter;

    const fixedOut = path.join(outDir, `00_parallel.fixed.json`);
    run('npm', ['run', 'fix:json', '--', current, fixedOut, ...modeArgs], { dryRun });
    current = fixedOut;

    run('ts-node', ['scripts/preflight-rewrites-json.ts', current, ...modeArgs], { dryRun });

    if (doReview) {
      console.log(`\n=== JSON-FIRST BOOK ${bookId} :: PARALLEL REVIEW (jobs=${jobs}) ===`);
      const reviewPaths = new Map<number, string>();
      await runChapterPool({
        chapters,
        jobs,
        dryRun,
        makeArgs: (ch: number) => {
          const reviewedOut = path.join(outDir, `ch${String(ch).padStart(2, '0')}.reviewed.json`);
          const logPath = path.join(outDir, `ch${String(ch).padStart(2, '0')}.review.log`);
          reviewPaths.set(ch, reviewedOut);
          return {
            cmd: 'npm',
            args: ['run', 'review:json', '--', current, reviewedOut, '--chapter', String(ch), ...passThrough],
            logPath,
            outPath: reviewedOut,
          };
        },
      });

      const mergedReviewed = path.join(outDir, `00_parallel.reviewed.merged.json`);
      if (!dryRun) {
        const m2 = mergeChapterOutputs({
          basePath: current,
          outPath: mergedReviewed,
          chapters,
          chapterJsonPaths: reviewPaths,
          jobs,
        });
        console.log(`Merged parallel review outputs → ${mergedReviewed} (updated=${m2.updated}, missing=${m2.missing})`);
      } else {
        console.log(`(dry-run) Would merge per-chapter review outputs → ${mergedReviewed}`);
      }
      current = mergedReviewed;

      const fixedAfterReview = path.join(outDir, `00_parallel.reviewed.fixed.json`);
      run('npm', ['run', 'fix:json', '--', current, fixedAfterReview, ...modeArgs], { dryRun });
      current = fixedAfterReview;

      run('ts-node', ['scripts/preflight-rewrites-json.ts', current, ...modeArgs], { dryRun });
    }
  }

  // Optional Pass 3: "quality sweep" (critical-only) for chapters that still have critical issues after iterate.
  // This is designed to scale: we rerun only problematic chapters, then merge+fix again.
  if (doQualitySweep && !dryRun) {
    const chaptersNeedingSweep: number[] = [];
    const perChapterSummary: Array<{ ch: number; critical: number; criticalSections: number; detErrors: number; score: number | null }> = [];
    for (const ch of chapters) {
      const pth = iterOutPaths.get(ch);
      if (!pth || !fs.existsSync(pth)) continue;
      try {
        const s = getCriticalIssuesSummaryFromIteratedJson(pth);
        perChapterSummary.push({ ch, critical: s.criticalIssuesTotal, criticalSections: s.criticalSections, detErrors: s.detErrors, score: s.finalScore });
        // Quality sweep criteria: critical issues, det errors, OR score < 60
        const needsSweep = s.criticalIssuesTotal > 0 || s.detErrors > 0 || (s.finalScore !== null && s.finalScore < 60);
        if (needsSweep) chaptersNeedingSweep.push(ch);
      } catch {
        // ignore parse errors; don't block the build
      }
    }

    // Production: also sweep chapters that fail the deterministic text gate.
    if (textGateEnabled) {
      console.log(`\n=== JSON-FIRST BOOK ${bookId} :: TEXT GATE (pre-sweep) ===`);
      const gate = runTextGate({ inJson: current, chapters, outDir, label: 'pre_sweep', dryRun: false, orphanWarnThreshold });
      if (gate.failingChapters.length > 0) {
        console.log(`Chapters failing text gate: ${gate.failingChapters.join(',')}`);
        for (const ch of gate.failingChapters) chaptersNeedingSweep.push(ch);
      } else {
        console.log(`✅ Text gate: no failing chapters`);
      }
    }

    const chaptersNeedingSweepUniq = Array.from(new Set(chaptersNeedingSweep)).sort((a, b) => a - b);

    if (chaptersNeedingSweepUniq.length > 0) {
      console.log(`\n=== JSON-FIRST BOOK ${bookId} :: QUALITY SWEEP (critical-only) ===`);
      console.log(`Chapters needing sweep: ${chaptersNeedingSweepUniq.join(',')}`);

      // Run another iterate round on the already-merged+fixed JSON, but only for these chapters.
      const sweepPaths = new Map<number, string>();
      const sweepOutPrefix = `qs${qualitySweepMaxIters}`;
      const toRun = chaptersNeedingSweepUniq;

      if (jobs <= 1) {
        for (const ch of toRun) {
          const outP = path.join(outDir, `ch${String(ch).padStart(2, '0')}.${sweepOutPrefix}.iterated.json`);
          const logP = path.join(outDir, `ch${String(ch).padStart(2, '0')}.${sweepOutPrefix}.iterate.log`);
          sweepPaths.set(ch, outP);
          await runAsync('npm', ['run', 'iterate:json', '--', current, outP, '--chapter', String(ch), ...passThroughQualitySweep], {
            dryRun: false,
            logPath: logP,
            label: `ch${String(ch).padStart(2, '0')}`,
          });
        }
      } else {
        await runChapterPool({
          chapters: toRun,
          jobs,
          dryRun: false,
          makeArgs: (ch: number) => {
            const outP = path.join(outDir, `ch${String(ch).padStart(2, '0')}.${sweepOutPrefix}.iterated.json`);
            const logP = path.join(outDir, `ch${String(ch).padStart(2, '0')}.${sweepOutPrefix}.iterate.log`);
            sweepPaths.set(ch, outP);
            return {
              cmd: 'npm',
              args: ['run', 'iterate:json', '--', current, outP, '--chapter', String(ch), ...passThroughQualitySweep],
              logPath: logP,
              outPath: outP,
            };
          },
        });
      }

      const mergedSweepIter = path.join(outDir, `00_quality_sweep.iterated.merged.json`);
      const m3 = mergeChapterOutputs({
        basePath: current,
        outPath: mergedSweepIter,
        chapters: chaptersNeedingSweepUniq,
        chapterJsonPaths: sweepPaths,
        jobs: Math.max(1, jobs),
      });
      console.log(`Merged quality sweep outputs → ${mergedSweepIter} (updated=${m3.updated}, missing=${m3.missing})`);
      current = mergedSweepIter;

      const fixedOut = path.join(outDir, `00_quality_sweep.fixed.json`);
      run('npm', ['run', 'fix:json', '--', current, fixedOut, ...modeArgs], { dryRun: false });
      current = fixedOut;

      run('npx', ['ts-node', 'scripts/preflight-rewrites-json.ts', current, ...modeArgs], { dryRun: false });

      if (textGateEnabled) {
        console.log(`\n=== JSON-FIRST BOOK ${bookId} :: TEXT GATE (post-sweep) ===`);
        const gateAfter = runTextGate({ inJson: current, chapters, outDir, label: 'post_sweep', dryRun: false, orphanWarnThreshold });
        if (gateAfter.failingChapters.length > 0) {
          throw new Error(
            `❌ Text gate failed after quality sweep for chapters: ${gateAfter.failingChapters.join(',')}. ` +
              `See per-chapter lint reports in: ${outDir}`
          );
        }
        console.log(`✅ Text gate: passed (post-sweep)`);
      }
    } else {
      console.log(`\n=== JSON-FIRST BOOK ${bookId} :: QUALITY SWEEP ===`);
      console.log(`No chapters reported remaining critical issues; skipping quality sweep.`);
    }
  }

  // Final numbering gate (cheap safety check; should not change but we assert)
  run('python3', ['scripts/verify-json-numbering-vs-n4.py', '--json', current, '--idml', idmlPath, '--require-subfield', 'true'], {
    dryRun,
  });

  // Write final output
  console.log(`\nWriting final JSON: ${finalOut}`);
  if (!dryRun) fs.copyFileSync(current, finalOut);

  // Optional promote (copies to ~/Desktop/rewrites_for_indesign.json + backup)
  if (doPromote) {
    console.log(`\nPromoting final JSON to ~/Desktop/rewrites_for_indesign.json ...`);
    run('npm', ['run', 'promote:json', '--', finalOut, ...modeArgs], { dryRun });
  }

  console.log(`\n✅ DONE: JSON-first whole-book build complete`);
  console.log(`   book: ${bookId}`);
  console.log(`   chapters: ${chapters.join(',')}`);
  console.log(`   outDir: ${outDir}`);
  console.log(`   final: ${finalOut}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


