/**
 * LLM-powered hyphenation fixer (Prince pipeline only)
 *
 * Goal:
 * - Detect invalid hyphenations in the generated PDF (Dutch patterns).
 * - Produce/extend `templates/hyphenation_exceptions.json` so the renderer inserts WORD JOINER
 *   (U+2060) at known-bad break positions, preventing those breaks in this and future renders.
 *
 * This does NOT touch the InDesign pipeline; it only affects the Prince HTML/PDF renderer.
 *
 * Usage:
 *   npx tsx new_pipeline/fix/llm-fix-hyphenation.ts \
 *     --pdf new_pipeline/output/canonical_ch1_professional.pdf \
 *     --exceptions new_pipeline/templates/hyphenation_exceptions.json \
 *     [--model gpt-5.2] [--dry-run] [--no-llm]
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { fileURLToPath } from 'url';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ScanReport = {
  pdf: string;
  pages: number;
  hyphenated_linebreaks: number;
  invalid_count: number;
  invalid: Array<{
    page: number;
    left: string;
    right: string;
    full: string;
    break_pos: number;
    allowed: string;
  }>;
};

type ExceptionsFile = {
  words: Record<string, number[]>;
  generated_at?: string;
  generated_by?: string;
  source_pdf?: string;
};

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
  console.error(msg);
  process.exit(1);
}

function toInt(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function mergePositions(a: number[] | undefined, b: number[]): number[] {
  const out = new Set<number>();
  for (const x of a || []) if (Number.isFinite(x) && x > 0) out.add(Math.floor(x));
  for (const x of b || []) if (Number.isFinite(x) && x > 0) out.add(Math.floor(x));
  return Array.from(out).sort((x, y) => x - y);
}

function buildProposedRulesFromScan(scan: ScanReport): Record<string, number[]> {
  const m: Record<string, number[]> = {};
  for (const r of scan.invalid || []) {
    const w = String(r.full || '').trim();
    const p = Number(r.break_pos);
    if (!w || !Number.isFinite(p) || p <= 0) continue;
    m[w] = mergePositions(m[w], [p]);
  }
  return m;
}

function runScan(opts: { pdfAbsPath: string; repoRoot: string }): ScanReport {
  const scanScript = path.resolve(opts.repoRoot, 'new_pipeline/validate/scan-hyphenation.py');
  if (!fs.existsSync(scanScript)) die(`❌ Not found: ${scanScript}`);

  const res = spawnSync('python3', [scanScript, opts.pdfAbsPath, '--json'], { encoding: 'utf8' });
  if (res.status !== 0) {
    die(`❌ Hyphenation scan failed:\n${String(res.stdout || '')}${String(res.stderr || '')}`);
  }

  const raw = String(res.stdout || '').trim();
  if (!raw) die('❌ Hyphenation scan returned empty output');

  try {
    return JSON.parse(raw) as ScanReport;
  } catch (e: any) {
    die(`❌ Failed parsing scan JSON: ${e?.message || String(e)}\n---\n${raw.slice(0, 2000)}`);
  }
}

async function llmSelectRules(opts: {
  apiKey: string;
  model: string;
  existing: ExceptionsFile;
  proposed: Record<string, number[]>;
  scan: ScanReport;
}): Promise<Record<string, number[]>> {
  const openai = new OpenAI({ apiKey: opts.apiKey });

  const system = [
    'You are a meticulous Dutch DTP QA assistant.',
    'We are fixing *incorrect hyphenation breaks* in a PDF produced by Prince.',
    'Output MUST be valid JSON only (no markdown), matching this schema:',
    '{ "words": { "<exact word>": [<forbidden break positions as integers>] } }',
    'Rules:',
    '- Keep words exactly as provided (case-sensitive).',
    '- Only include entries that are needed (new or refined rules).',
    '- Positions are the character count BEFORE which a WORD JOINER (U+2060) will be inserted.',
    '- Do not invent new words; use only words present in the input.',
    '- Prefer minimal rules: if a word has multiple invalid break positions, include them all.',
  ].join('\n');

  const user = {
    existing_rules: opts.existing.words || {},
    proposed_rules_from_scan: opts.proposed,
    scan_summary: {
      pdf: opts.scan.pdf,
      pages: opts.scan.pages,
      hyphenated_linebreaks: opts.scan.hyphenated_linebreaks,
      invalid_count: opts.scan.invalid_count,
      invalid_examples: (opts.scan.invalid || []).slice(0, 60),
    },
  };

  const resp = await openai.chat.completions.create({
    model: opts.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(user) },
    ],
    // Keep deterministic-ish
    temperature: 0.1,
  });

  const content = String(resp.choices?.[0]?.message?.content || '').trim();
  if (!content) throw new Error('LLM returned empty content');

  // Parse JSON (best-effort)
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Try extract JSON substring
    const m = content.match(/\{[\s\S]*\}$/);
    if (!m) throw new Error(`LLM did not return JSON.\n---\n${content.slice(0, 1200)}`);
    parsed = JSON.parse(m[0]);
  }

  const words = parsed?.words;
  if (!words || typeof words !== 'object') throw new Error(`LLM JSON missing 'words' object.`);

  const out: Record<string, number[]> = {};
  for (const [w, arr] of Object.entries(words)) {
    if (!w) continue;
    if (!Array.isArray(arr)) continue;
    const nums = arr.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.floor(n));
    if (!nums.length) continue;
    out[w] = mergePositions([], nums);
  }

  return out;
}

async function main() {
  // Load env from the same place our DB scripts use
  const envPath = '/Users/asafgafni/Desktop/bookautomation/book-insight-craft-main/.env';
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
  else dotenv.config();

  const repoRoot = path.resolve(__dirname, '../..'); // project root (parent of new_pipeline/)

  const pdfArg = getArg('--pdf') || 'new_pipeline/output/canonical_ch1_professional.pdf';
  const exceptionsArg = getArg('--exceptions') || 'new_pipeline/templates/hyphenation_exceptions.json';
  const model = getArg('--model') || 'gpt-5.2';
  const dryRun = hasFlag('--dry-run');
  const noLlm = hasFlag('--no-llm');

  const pdfAbs = path.resolve(repoRoot, pdfArg);
  const excAbs = path.resolve(repoRoot, exceptionsArg);

  if (!fs.existsSync(pdfAbs)) die(`❌ PDF not found: ${pdfAbs}`);

  // Load existing exceptions
  let existing: ExceptionsFile = { words: {} };
  if (fs.existsSync(excAbs)) {
    try {
      const raw = fs.readFileSync(excAbs, 'utf8');
      const parsed = JSON.parse(raw) as ExceptionsFile;
      existing = { words: parsed.words || {}, ...parsed };
    } catch {
      existing = { words: {} };
    }
  }

  const scan = runScan({ pdfAbsPath: pdfAbs, repoRoot });
  console.log(`🔎 Hyphenation scan: invalid=${scan.invalid_count} (pages=${scan.pages}, hyph=${scan.hyphenated_linebreaks})`);
  if (!scan.invalid_count) {
    console.log('✅ No invalid hyphenations detected.');
    return;
  }

  const proposed = buildProposedRulesFromScan(scan);

  // Determine which rules are new vs existing
  const newOnly: Record<string, number[]> = {};
  for (const [w, pos] of Object.entries(proposed)) {
    const merged = mergePositions(existing.words?.[w], pos);
    const existingSet = new Set((existing.words?.[w] || []).map((n) => Math.floor(Number(n))));
    const added = merged.filter((n) => !existingSet.has(n));
    if (added.length) newOnly[w] = added;
  }

  if (!Object.keys(newOnly).length) {
    console.log('✅ No new hyphenation exception rules needed (already covered).');
    return;
  }

  let selected: Record<string, number[]> = {};

  if (noLlm) {
    selected = newOnly;
  } else {
    const apiKey = String(process.env.OPENAI_API_KEY ?? '').trim();
    if (!apiKey) {
      console.warn('⚠️  Missing OPENAI_API_KEY; falling back to deterministic rules. (Use --no-llm to silence)');
      selected = newOnly;
    } else if (apiKey === 'your-openai-key') {
      console.warn('⚠️  OPENAI_API_KEY is placeholder; falling back to deterministic rules.');
      selected = newOnly;
    } else {
      try {
        selected = await llmSelectRules({ apiKey, model, existing, proposed: newOnly, scan });
      } catch (e: any) {
        console.warn(`⚠️  LLM step failed; falling back to deterministic rules: ${e?.message || String(e)}`);
        selected = newOnly;
      }
    }
  }

  if (!Object.keys(selected).length) {
    console.log('✅ LLM produced no rules (nothing to write).');
    return;
  }

  // Merge selected into existing
  const merged: ExceptionsFile = {
    ...existing,
    words: { ...(existing.words || {}) },
    generated_at: new Date().toISOString(),
    generated_by: `new_pipeline/fix/llm-fix-hyphenation.ts${noLlm ? ' (no-llm)' : ''}`,
    source_pdf: pdfAbs,
  };

  for (const [w, pos] of Object.entries(selected)) {
    merged.words[w] = mergePositions(merged.words[w], pos);
  }

  const pretty = JSON.stringify(merged, null, 2) + '\n';

  console.log(`📝 Writing hyphenation exceptions: ${excAbs}`);
  console.log(`   words total: ${Object.keys(merged.words).length}`);
  console.log(`   words added/updated: ${Object.keys(selected).length}`);

  if (dryRun) {
    console.log('   (dry-run; not writing)');
    return;
  }

  fs.mkdirSync(path.dirname(excAbs), { recursive: true });
  fs.writeFileSync(excAbs, pretty, 'utf8');
  console.log('✅ Done. Re-render the PDF to apply the new exceptions.');
}

main().catch((e) => die(e?.message || String(e)));


