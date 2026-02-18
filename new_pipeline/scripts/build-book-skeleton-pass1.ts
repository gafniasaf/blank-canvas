/**
 * Build a full-book PDF using the Skeleton-first Pass 1 pipeline (Prince-first),
 * starting from an existing canonical book JSON (no DB export required).
 *
 * Flow (per book):
 * - Extract PV-style tokens from the book's canonical IDML snapshot (for CSS)
 * - Split canonical book JSON -> per-chapter JSONs (self-contained)
 * - For each chapter: extract skeleton -> generate rewrites -> assemble
 * - Merge chapters -> apply chapter openers -> microtitle cleanup -> render PDF
 *
 * Usage:
 *   cd new_pipeline
 *   npx tsx scripts/build-book-skeleton-pass1.ts --book <book_id>
 *
 * Optional:
 *   --canonical <path-to-canonical-book.json>   (defaults to output/_canonical_jsons_all/<book_id>__canonical_book_with_figures.json)
 *   --idml <path-to-idml>                      (defaults to books/manifest.json canonical_n4_idml_path)
 *   --slug <short-name>                        (defaults to a stable mapping for known books)
 *   --provider anthropic|openai                (default: anthropic)
 *   --model <model>                            (default: claude-sonnet-4-5-20250929)
 *   --out-pdf <path>                           (default: output/<slug>_full_skeleton_pass1_professional.with_openers.no_figures.pdf)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/load-env';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const PIPELINE_ROOT = path.resolve(REPO_ROOT, 'new_pipeline');

type Manifest = {
  version?: number;
  books?: Array<{
    book_id: string;
    canonical_n4_idml_path?: string;
  }>;
};

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return String(v);
}

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function timestampId(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function resolveFromRepo(p: string): string {
  const s = String(p || '').trim();
  if (!s) return '';
  if (path.isAbsolute(s)) return s;
  return path.resolve(REPO_ROOT, s.replace(/^\.\//, ''));
}

function loadManifest(): Manifest {
  const p = path.resolve(REPO_ROOT, 'books', 'manifest.json');
  if (!fs.existsSync(p)) die(`books/manifest.json not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Manifest;
}

const DEFAULT_SLUG_BY_BOOK_ID: Record<string, string> = {
  MBO_AF4_2024_COMMON_CORE: 'af4',
  MBO_COMMUNICATIE_9789083251387_03_2024: 'communicatie',
  MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_9789083412030_03_2024: 'klinisch_redeneren',
  MBO_METHODISCH_WERKEN_9789083251394_03_2024: 'methodisch_werken',
  MBO_WETGEVING_9789083412061_03_2024: 'wetgeving',
  MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024: 'persoonlijke_verzorging',
};

function run(cmd: string, args: string[], opts?: { cwd?: string; logFileAbs?: string }) {
  const cwd = opts?.cwd || PIPELINE_ROOT;
  const log = opts?.logFileAbs ? path.resolve(opts.logFileAbs) : null;
  const outFd = log ? fs.openSync(log, 'a') : undefined;
  const errFd = log ? fs.openSync(log, 'a') : undefined;
  const res = spawnSync(cmd, args, {
    cwd,
    env: process.env,
    stdio: log ? ['ignore', outFd!, errFd!] : 'inherit',
  });
  if (log) {
    try {
      if (typeof outFd === 'number') fs.closeSync(outFd);
      if (typeof errFd === 'number') fs.closeSync(errFd);
    } catch {
      // ignore
    }
  }
  if (res.status !== 0) {
    die(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

type CanonicalBook = {
  meta?: any;
  chapters?: Array<{ number: string; title?: string; sections?: any[] }>;
};

function parseChapterNum(n: string): number | null {
  const x = Number(String(n || '').trim());
  if (!Number.isFinite(x) || x <= 0) return null;
  return Math.floor(x);
}

function main() {
  loadEnv();

  const bookId = String(getArg('--book') || getArg('--book-id') || '').trim();
  if (!bookId) die('Missing --book <book_id>');

  const slug = String(getArg('--slug') || '').trim() || DEFAULT_SLUG_BY_BOOK_ID[bookId] || bookId.toLowerCase();
  const provider = String(getArg('--provider') || 'anthropic').trim();
  const model = String(getArg('--model') || 'claude-sonnet-4-5-20250929').trim();

  const canonicalArg = String(getArg('--canonical') || '').trim();
  const canonicalAbs = canonicalArg
    ? resolveFromRepo(canonicalArg)
    : path.resolve(PIPELINE_ROOT, 'output', '_canonical_jsons_all', `${bookId}__canonical_book_with_figures.json`);
  if (!fs.existsSync(canonicalAbs)) die(`Canonical book JSON not found: ${canonicalAbs}`);

  const idmlArg = String(getArg('--idml') || '').trim();
  let idmlAbs = idmlArg ? resolveFromRepo(idmlArg) : '';
  if (!idmlAbs) {
    const manifest = loadManifest();
    const m = (Array.isArray(manifest.books) ? manifest.books : []).find((b) => String(b.book_id || '') === bookId);
    if (!m?.canonical_n4_idml_path) die(`No canonical_n4_idml_path for ${bookId} in books/manifest.json (pass --idml)`);
    idmlAbs = resolveFromRepo(m.canonical_n4_idml_path);
  }
  if (!fs.existsSync(idmlAbs)) die(`IDML snapshot not found: ${idmlAbs}`);

  const outPdfArg = String(getArg('--out-pdf') || '').trim();
  const outPdfAbs = outPdfArg
    ? resolveFromRepo(outPdfArg)
    : path.resolve(PIPELINE_ROOT, 'output', `${slug}_full_skeleton_pass1_professional.with_openers.no_figures.pdf`);

  const runRootAbs = path.resolve(PIPELINE_ROOT, 'output', `${slug}_skeleton`);
  const runDirAbs = path.resolve(runRootAbs, `full_${timestampId()}`);
  fs.mkdirSync(runDirAbs, { recursive: true });
  fs.writeFileSync(path.resolve(runRootAbs, 'LAST_RUN.txt'), runDirAbs + '\n', 'utf8');

  const dirs = {
    canonicalChapters: path.resolve(runDirAbs, 'canonical_chapters'),
    skeleton: path.resolve(runDirAbs, 'skeleton'),
    rewrites: path.resolve(runDirAbs, 'rewrites'),
    assembled: path.resolve(runDirAbs, 'assembled'),
    logs: path.resolve(runDirAbs, 'logs'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

  console.log(`📚 Skeleton-first pass1 build: ${bookId}`);
  console.log(`   slug: ${slug}`);
  console.log(`   canonical: ${canonicalAbs}`);
  console.log(`   idml: ${idmlAbs}`);
  console.log(`   provider/model: ${provider} / ${model}`);
  console.log(`   run dir: ${runDirAbs}`);
  console.log(`   out pdf: ${outPdfAbs}`);

  const book = JSON.parse(fs.readFileSync(canonicalAbs, 'utf8')) as CanonicalBook;
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  if (!chapters.length) die('Canonical book JSON has no chapters[]');

  const chapterNums = chapters
    .map((ch) => parseChapterNum(String(ch.number || '')))
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  const tokensChapter = chapterNums.length ? chapterNums[0]! : 1;

  // Step 0: tokens + token CSS
  // IMPORTANT: write tokens + token CSS into the per-run folder so parallel builds don't clobber each other.
  const tokensJsonAbs = path.resolve(runDirAbs, 'design_tokens.json');
  const tokenCssAbs = path.resolve(runDirAbs, 'prince-af-two-column.tokens.css');
  const baseCssAbs = path.resolve(REPO_ROOT, 'new_pipeline', 'templates', 'prince-af-two-column.css');

  run('npx', [
    'tsx',
    'extract/parse-idml-design-tokens.ts',
    idmlAbs,
    '--chapter',
    String(tokensChapter),
    '--out',
    tokensJsonAbs,
  ]);
  run('npx', [
    'tsx',
    'templates/generate-prince-css-from-tokens.ts',
    '--tokens',
    tokensJsonAbs,
    '--base',
    baseCssAbs,
    '--out',
    tokenCssAbs,
  ]);
  run('npx', ['tsx', 'validate/verify-design-tokens.ts', tokensJsonAbs]);

  // Step 1: split canonical -> per-chapter canonical JSONs (self-contained)
  const chapterEntries: Array<{ chNum: number; chNumStr: string; canonicalAbs: string }> = [];
  for (const ch of chapters) {
    const chNumStr = String(ch?.number || '').trim();
    const chNum = parseChapterNum(chNumStr);
    if (!chNum) continue;
    const outName = `canonical_ch${pad2(chNum)}.json`;
    const outAbs = path.resolve(dirs.canonicalChapters, outName);
    const payload = { meta: book.meta, chapters: [ch] };
    fs.writeFileSync(outAbs, JSON.stringify(payload, null, 2), 'utf8');
    chapterEntries.push({ chNum, chNumStr, canonicalAbs: outAbs });
  }
  if (!chapterEntries.length) die('No numeric chapters found in canonical JSON');
  chapterEntries.sort((a, b) => a.chNum - b.chNum);

  // Step 2: per chapter rewrite
  for (const ent of chapterEntries) {
    const ch = ent.chNum;
    const chPad = pad2(ch);
    const logAbs = path.resolve(dirs.logs, `ch${chPad}.log`);
    fs.writeFileSync(logAbs, `=== CH${chPad} (${bookId}) ===\n`, 'utf8');

    const skeletonAbs = path.resolve(dirs.skeleton, `skeleton_ch${chPad}.json`);
    const rewritesAbs = path.resolve(dirs.rewrites, `rewrites_ch${chPad}.json`);
    const assembledAbs = path.resolve(dirs.assembled, `assembled_ch${chPad}.json`);

    // Allow resume
    if (fs.existsSync(assembledAbs) && fs.statSync(assembledAbs).size > 0) {
      console.log(`✅ [skip] CH${chPad} already assembled`);
      continue;
    }

    console.log(`🦴 CH${chPad}: extract → generate → assemble`);
    fs.appendFileSync(logAbs, '[extract]\n', 'utf8');
    run('npx', [
      'tsx',
      'scripts/extract-skeleton.ts',
      ent.canonicalAbs,
      skeletonAbs,
      '--chapter',
      String(ch),
      '--provider',
      provider,
      '--model',
      model,
    ], { logFileAbs: logAbs });

    fs.appendFileSync(logAbs, '[generate]\n', 'utf8');
    run('npx', [
      'tsx',
      'scripts/generate-from-skeleton.ts',
      '--skeleton',
      skeletonAbs,
      '--out',
      rewritesAbs,
      '--provider',
      provider,
      '--model',
      model,
    ], { logFileAbs: logAbs });

    fs.appendFileSync(logAbs, '[assemble]\n', 'utf8');
    run('npx', ['tsx', 'scripts/assemble-skeleton-rewrites.ts', ent.canonicalAbs, skeletonAbs, rewritesAbs, assembledAbs], {
      logFileAbs: logAbs,
    });
  }

  // Step 3: merge chapters
  const mergedAbs = path.resolve(runDirAbs, `${slug}_skeleton_pass1_merged.json`);
  run('npx', ['tsx', 'scripts/merge-assembled-chapters.ts', dirs.assembled, mergedAbs]);

  // Step 4: apply openers
  const openersAbs = path.resolve(runDirAbs, `${slug}_skeleton_pass1_merged.with_openers.json`);
  run('npx', ['tsx', 'scripts/apply-chapter-openers.ts', mergedAbs, '--out', openersAbs, '--book', bookId]);

  // Step 5: microfix
  const microfixAbs = path.resolve(runDirAbs, `${slug}_skeleton_pass1_merged.with_openers.microfix.json`);
  run('npx', ['tsx', 'fix/remove-leading-microtitles-under-headings.ts', openersAbs, '--out', microfixAbs, '--quiet']);

  // Step 6: render
  const princeLogAbs = path.resolve(runDirAbs, `${slug}_skeleton_pass1_prince.log`);
  run('npx', [
    'tsx',
    'renderer/render-prince-pdf.ts',
    microfixAbs,
    '--out',
    outPdfAbs,
    '--log',
    princeLogAbs,
    '--align',
    'left',
    '--css',
    tokenCssAbs,
  ]);

  console.log(`✅ Done: ${outPdfAbs}`);
}

main();


