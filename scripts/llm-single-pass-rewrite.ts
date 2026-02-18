/**
 * llm-single-pass-rewrite.ts
 *
 * SIMPLIFIED PIPELINE - Proof of Concept
 *
 * Architecture:
 *   1. Single LLM write pass (no check/repair loop)
 *   2. Deterministic fixes only (no LLM checker)
 *   3. Clear, focused prompts (fewer conflicting rules)
 *
 * Rationale:
 *   - LLM checker was hallucinating issues
 *   - Check/repair loop caused circular regressions
 *   - Simpler = more predictable
 *
 * Usage:
 *   npx ts-node scripts/llm-single-pass-rewrite.ts <inJson> <outJson> \
 *     [--chapter 1] [--provider anthropic] [--model claude-opus-4-5-20251101]
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

import { validateCombinedRewriteText } from '../src/lib/indesign/rewritesForIndesign';
import {
  lintRewritesForIndesignJsonParagraphs,
  type RewritesForIndesignParagraph,
} from '../src/lib/indesign/rewritesForIndesignJsonLint';
import { applyDeterministicFixesToParagraphs } from '../src/lib/indesign/rewritesForIndesignFixes';

// Load env
try {
  const localPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(localPath)) dotenv.config({ path: localPath });
} catch {}
dotenv.config();

// ============================================================================
// UTILS
// ============================================================================

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableError(e: any): boolean {
  const msg = String(e?.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return true;
  if (msg.includes('connection error') || msg.includes('fetch failed')) return true;
  if (msg.includes('rate limit') || msg.includes('429')) return true;
  const status = Number(e?.status || e?.statusCode || 0);
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  return false;
}

async function withRetries<T>(label: string, fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) console.log(`  ↻ ${label}: retry ${attempt}/${maxAttempts}...`);
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!isRetryableError(e) || attempt === maxAttempts) throw e;
      const delay = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
      await sleep(delay);
    }
  }
  throw lastErr;
}

type LlmProvider = 'openai' | 'anthropic';

async function llmChat(opts: {
  provider: LlmProvider;
  model: string;
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const { provider, model, system, user, temperature = 0.3 } = opts;

  if (provider === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('Missing ANTHROPIC_API_KEY');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: 8192,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${txt}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text || '';
  } else {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.chat.completions.create({
      model,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return res.choices?.[0]?.message?.content || '';
  }
}

function parseJson<T>(raw: string, label: string): T {
  let s = raw.trim();
  // Strip markdown code fences
  if (s.startsWith('```')) {
    s = s.replace(/^```[^\n]*\n/, '').replace(/\n```\s*$/, '').trim();
  }
  // Find first { or [
  const i1 = s.indexOf('{');
  const i2 = s.indexOf('[');
  const start = i1 >= 0 && i2 >= 0 ? Math.min(i1, i2) : i1 >= 0 ? i1 : i2;
  if (start > 0) s = s.slice(start);
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`JSON parse failed for ${label}: ${e}\nRaw:\n${raw.slice(0, 500)}`);
  }
}

// ============================================================================
// SIMPLIFIED SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `Je bent een ervaren Nederlandse redacteur voor MBO-lesmateriaal (niveau 3/4).

TAAK: Herschrijf de gegeven paragrafen naar helder, toegankelijk Nederlands.

REGELS (strikt):
1. Behoud ALLE feitelijke informatie - niets weglaten, niets toevoegen
2. Maak zinnen korter en eenvoudiger waar mogelijk
3. Gebruik actieve zinnen i.p.v. passieve
4. Vermijd jargon; leg vaktermen uit bij eerste gebruik
5. Eindig elke zin correct (geen losse fragmenten)

FORMATTING:
- Output alleen JSON: { "paragraphs": [ { "paragraph_id": "...", "rewritten": "..." } ] }
- Gebruik alleen \\n voor regeleindes (geen \\r)
- Behoud bestaande praktijk/verdieping markers exact zoals ze zijn

BULLETS/LIJSTEN:
- Als origineel een opsomming heeft met puntkomma's, mag je kiezen:
  a) Herschrijf als vloeiende tekst (aanbevolen bij lange items)
  b) Behoud als lijst met korte items (max 15 woorden per item)
- Meng niet: kies één stijl per paragraaf

NIET DOEN:
- Geen nieuwe feiten toevoegen
- Geen zinnen afbreken halverwege
- Geen dubbele interpunctie (zoals ";.")
- Geen herhaling van dezelfde woorden in één zin`;

// ============================================================================
// MAIN LOGIC
// ============================================================================

type Paragraph = RewritesForIndesignParagraph;
type InputJson = { paragraphs: Paragraph[]; [k: string]: any };

const MAX_PARAS_PER_BATCH = 20; // Prevent token overflow

function groupBySection(paragraphs: Paragraph[]): Map<string, Paragraph[]> {
  const map = new Map<string, Paragraph[]>();
  for (const p of paragraphs) {
    const ch = String(p.chapter || '').trim();
    const pn = p.paragraph_number;
    const spn = p.subparagraph_number;
    // Use subparagraph for finer grouping
    const section = spn != null ? `${ch}.${pn}.${spn}` : pn != null ? `${ch}.${pn}` : ch;
    if (!map.has(section)) map.set(section, []);
    map.get(section)!.push(p);
  }
  
  // Split large sections into batches
  const result = new Map<string, Paragraph[]>();
  for (const [section, paras] of map) {
    if (paras.length <= MAX_PARAS_PER_BATCH) {
      result.set(section, paras);
    } else {
      // Split into batches
      for (let i = 0; i < paras.length; i += MAX_PARAS_PER_BATCH) {
        const batch = paras.slice(i, i + MAX_PARAS_PER_BATCH);
        const batchNum = Math.floor(i / MAX_PARAS_PER_BATCH) + 1;
        result.set(`${section}_b${batchNum}`, batch);
      }
    }
  }
  return result;
}

async function rewriteSection(
  section: string,
  paragraphs: Paragraph[],
  provider: LlmProvider,
  model: string
): Promise<{ paragraph_id: string; rewritten: string }[]> {
  const user = JSON.stringify({
    section,
    paragraphs: paragraphs.map((p) => ({
      paragraph_id: p.paragraph_id,
      style_name: p.style_name,
      original: p.original,
      current_rewritten: p.rewritten,
    })),
  });

  const raw = await withRetries(`rewrite ${section}`, () =>
    llmChat({ provider, model, system: SYSTEM_PROMPT, user })
  );

  const parsed = parseJson<{ paragraphs: { paragraph_id: string; rewritten: string }[] }>(
    raw,
    `section ${section}`
  );

  return parsed.paragraphs || [];
}

function runDeterministicFixes(paragraphs: Paragraph[]): {
  fixed: Paragraph[];
  fixCount: number;
} {
  // Apply existing deterministic fixes (mutates in place)
  const result = applyDeterministicFixesToParagraphs(paragraphs, { mode: 'prince' });
  const fixCount = result.punctuation_changed + result.list_intro_restored + result.heading_spacing_normalized + result.moves.length;
  return { fixed: paragraphs, fixCount };
}

function runDeterministicValidation(paragraphs: Paragraph[]): {
  errors: { paragraph_id: string; message: string }[];
  warnings: { paragraph_id: string; message: string }[];
} {
  const errors: { paragraph_id: string; message: string }[] = [];
  const warnings: { paragraph_id: string; message: string }[] = [];

  for (const p of paragraphs) {
    const txt = String(p.rewritten || '');
    const pid = String(p.paragraph_id || 'unknown');

    // Hard errors
    if (txt.includes('\r')) {
      errors.push({ paragraph_id: pid, message: 'Bevat \\r karakter' });
    }
    if (/[;\.]{2,}/.test(txt)) {
      errors.push({ paragraph_id: pid, message: 'Dubbele interpunctie gevonden' });
    }
    if (txt.trim().endsWith(',') || txt.trim().endsWith(';')) {
      errors.push({ paragraph_id: pid, message: 'Zin eindigt met komma of puntkomma' });
    }

    // Warnings
    if (/(\b\w{4,}\b)(?:\s+\1){1,}/i.test(txt)) {
      warnings.push({ paragraph_id: pid, message: 'Mogelijk herhaald woord' });
    }

    // Check for unfinished sentences (ends with common incomplete patterns)
    if (/\b(de|het|een|van|voor|met|door|op|in|aan)\s*$/i.test(txt.trim())) {
      errors.push({ paragraph_id: pid, message: 'Onafgemaakte zin (eindigt op voorzetsel/lidwoord)' });
    }
  }

  // Use existing lint for more checks
  const lintResult = lintRewritesForIndesignJsonParagraphs(paragraphs, { mode: 'prince' });
  for (const e of lintResult.errors) {
    errors.push({ paragraph_id: 'lint', message: e });
  }

  return { errors, warnings };
}

async function main() {
  const args = process.argv.slice(2);
  const inPath = args.find((a) => !a.startsWith('--')) || '';
  const outPath = args.filter((a) => !a.startsWith('--'))[1] || '';

  if (!inPath || !outPath) {
    console.error('Usage: npx ts-node scripts/llm-single-pass-rewrite.ts <in.json> <out.json> [--chapter N] [--provider anthropic|openai] [--model ...]');
    process.exit(1);
  }

  // Parse args
  const getArg = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
  };

  const chapterFilter = getArg('--chapter');
  const provider: LlmProvider = (getArg('--provider') || 'anthropic') as LlmProvider;
  const model = getArg('--model') || 'claude-opus-4-5-20251101';

  console.log(`\n🚀 SINGLE-PASS REWRITE PIPELINE`);
  console.log(`   Provider: ${provider}`);
  console.log(`   Model: ${model}`);
  console.log(`   Chapter: ${chapterFilter || 'all'}`);
  console.log(`   Input: ${inPath}`);
  console.log(`   Output: ${outPath}\n`);

  // Load input
  const input: InputJson = JSON.parse(fs.readFileSync(inPath, 'utf-8'));
  let paragraphs = [...input.paragraphs];

  // Filter by chapter
  if (chapterFilter) {
    paragraphs = paragraphs.filter((p) => String(p.chapter) === chapterFilter);
    console.log(`   Filtered to ${paragraphs.length} paragraphs in chapter ${chapterFilter}\n`);
  }

  // Group by section
  const sections = groupBySection(paragraphs);
  console.log(`   Processing ${sections.size} sections...\n`);

  // Process each section
  let processed = 0;
  let llmPatches = 0;
  const startTime = Date.now();

  for (const [section, sectionParas] of sections) {
    processed++;
    const pct = ((processed / sections.size) * 100).toFixed(0);
    process.stdout.write(`\r   [${pct}%] Section ${section} (${sectionParas.length} paras)...`);

    try {
      const patches = await rewriteSection(section, sectionParas, provider, model);

      // Apply patches
      for (const patch of patches) {
        const p = paragraphs.find((x) => x.paragraph_id === patch.paragraph_id);
        if (p && patch.rewritten) {
          p.rewritten = patch.rewritten;
          llmPatches++;
        }
      }
    } catch (e: any) {
      console.error(`\n   ⚠️ Section ${section} failed: ${e.message}`);
    }

    // Small delay to avoid rate limits
    await sleep(100);
  }

  console.log(`\n\n   ✅ LLM pass complete: ${llmPatches} paragraphs rewritten`);

  // Apply deterministic fixes
  console.log(`\n   🔧 Applying deterministic fixes...`);
  const { fixed, fixCount } = runDeterministicFixes(paragraphs);
  console.log(`   ✅ Applied ${fixCount} deterministic fixes`);

  // Run validation
  console.log(`\n   🔍 Running deterministic validation...`);
  const { errors, warnings } = runDeterministicValidation(fixed);
  console.log(`   📊 Errors: ${errors.length}, Warnings: ${warnings.length}`);

  if (errors.length > 0) {
    console.log(`\n   ❌ Sample errors:`);
    for (const e of errors.slice(0, 5)) {
      console.log(`      - ${e.paragraph_id}: ${e.message}`);
    }
  }

  // Build output
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const output = {
    ...input,
    paragraphs: chapterFilter
      ? input.paragraphs.map((p) => {
          const updated = fixed.find((f) => f.paragraph_id === p.paragraph_id);
          return updated || p;
        })
      : fixed,
    single_pass_report: {
      provider,
      model,
      chapter: chapterFilter || 'all',
      sections_processed: sections.size,
      llm_patches: llmPatches,
      deterministic_fixes: fixCount,
      errors: errors.length,
      warnings: warnings.length,
      elapsed_seconds: parseFloat(elapsed),
      timestamp: new Date().toISOString(),
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n   💾 Saved to ${outPath}`);
  console.log(`   ⏱️ Total time: ${elapsed}s\n`);

  // Summary
  const quality = errors.length === 0 ? '✅ CLEAN' : `⚠️ ${errors.length} errors`;
  console.log(`   📊 RESULT: ${quality}`);
  console.log(`      - LLM rewrites: ${llmPatches}`);
  console.log(`      - Det. fixes: ${fixCount}`);
  console.log(`      - Errors: ${errors.length}`);
  console.log(`      - Warnings: ${warnings.length}\n`);
}

main().catch((e) => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});

