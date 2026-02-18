/**
 * llm-review-rewrites-json.ts
 *
 * Goal:
 * - Run an LLM "human-like reviewer" pass over rewrites_for_indesign*.json and auto-apply SAFE fixes.
 *
 * Philosophy:
 * - Deterministic gates remain the source of truth (numbering/coverage/layout).
 * - This step is for *semantic placement sanity* of layer blocks (praktijk/verdieping) and prevents
 *   "floating blocks" that interrupt lists or topic flow.
 *
 * IMPORTANT safety constraints:
 * - Never modify `original` (used for InDesign matching).
 * - Never introduce '\r' (paragraph breaks). Keep '\n' only.
 * - Only allowed auto-edits (for now): MOVE/DROP/KEEP existing layer blocks within the SAME section
 *   (same chapter + paragraph_number + subparagraph_number). No new factual content.
 *
 * Usage:
 *   npx ts-node scripts/llm-review-rewrites-json.ts <inJsonPath> <outJsonPath> \
 *     [--chapter 2] [--model claude-opus-4-5-20251101] [--dry-run] [--sample-pages 2] [--words-per-page 550]
 *
 * Defaults:
 *   in:  ~/Desktop/rewrites_for_indesign.FIXED_DRAFT.json (if exists) else ~/Desktop/rewrites_for_indesign.json
 *   out: ~/Desktop/rewrites_for_indesign.LLM_REVIEWED.json
 */

import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import { OpenAI } from 'openai';

import { validateCombinedRewriteText } from '../src/lib/indesign/rewritesForIndesign';
import {
  PR_MARKER,
  VE_MARKER,
  lintRewritesForIndesignJsonParagraphs,
  type RewriteLintMode,
  type RewritesForIndesignParagraph,
} from '../src/lib/indesign/rewritesForIndesignJsonLint';
import { applyDeterministicFixesToParagraphs, buildCombined, parseCombined } from '../src/lib/indesign/rewritesForIndesignFixes';

// Load env in local-dev friendly order:
// - .env (default)
// - .env.local (overrides; not committed)
dotenv.config();
try {
  const localPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(localPath)) dotenv.config({ path: localPath, override: true });
} catch {
  // ignore
}

// ---------------------------
// OpenAI resilience (required for long-running whole-book jobs)
// ---------------------------
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableOpenAiError(e: any): boolean {
  const msg = String(e?.message || e?.toString?.() || '').toLowerCase();
  if (msg.includes('connection error')) return true;
  if (msg.includes('etimedout') || msg.includes('timeout')) return true;
  if (msg.includes('econnreset') || msg.includes('econnrefused')) return true;
  if (msg.includes('socket hang up')) return true;

  const status = Number(e?.status || e?.statusCode || e?.response?.status);
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

async function withRetries<T>(label: string, fn: () => Promise<T>, opts?: { maxAttempts?: number }) {
  const maxAttempts = Math.max(1, Math.floor(Number(opts?.maxAttempts ?? 6)));
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) console.log(`${label}: retry attempt ${attempt}/${maxAttempts}...`);
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!isRetryableOpenAiError(e) || attempt === maxAttempts) throw e;
      const base = Math.min(30_000, 1000 * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 300);
      await sleep(base + jitter);
    }
  }
  throw lastErr;
}

type JsonShape = {
  book_title?: string;
  upload_id?: string;
  layer?: string;
  chapter_filter?: string | null;
  generated_at?: string;
  total_paragraphs?: number;
  generation_warnings?: any;
  paragraphs: RewritesForIndesignParagraph[];
  fixed_at?: string;
  fixed_by?: string;
  fix_warnings?: any;
  llm_reviewed_at?: string;
  llm_reviewed_by?: string;
  llm_review_report?: any;
};

type SectionKey = string; // "ch.pn.sp" (sp can be "null")

function countWordsRough(text: string): number {
  const m = String(text ?? '').match(/[0-9A-Za-zÀ-ÖØ-öø-ÿ]+/g);
  return m ? m.length : 0;
}

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

function sectionKey(p: RewritesForIndesignParagraph): SectionKey {
  const ch = String(p.chapter ?? '').trim() || '?';
  const pn = Number.isFinite(p.paragraph_number as any) ? String(p.paragraph_number) : '?';
  const sp =
    p.subparagraph_number === null || p.subparagraph_number === undefined
      ? 'null'
      : Number.isFinite(p.subparagraph_number as any)
        ? String(p.subparagraph_number)
        : String(p.subparagraph_number);
  return `${ch}.${pn}.${sp}`;
}

function truncate(s: string, max: number) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 3)) + '...';
}

function selectSectionKeysForSample(opts: {
  sectionOrder: SectionKey[];
  sections: Map<SectionKey, RewritesForIndesignParagraph[]>;
  samplePages: number;
  wordsPerPage: number;
}): { keys: SectionKey[]; sections: number; approxWords: number; budgetWords: number } {
  const samplePages = Math.max(0, Math.floor(Number(opts.samplePages) || 0));
  if (!samplePages) return { keys: opts.sectionOrder, sections: opts.sectionOrder.length, approxWords: 0, budgetWords: 0 };
  const wordsPerPage = Math.max(200, Math.floor(Number(opts.wordsPerPage) || 550));
  const budgetWords = samplePages * wordsPerPage;

  const keys: SectionKey[] = [];
  let approxWords = 0;
  for (const sk of opts.sectionOrder) {
    if (keys.length > 0 && approxWords >= budgetWords) break;
    keys.push(sk);
    const ps = opts.sections.get(sk) || [];
    for (const p of ps) approxWords += countWordsRough(String(p.original ?? ''));
  }
  return { keys, sections: keys.length, approxWords, budgetWords };
}

function mustNoCarriageReturns(paras: RewritesForIndesignParagraph[]) {
  for (const p of paras) {
    const rw = String(p.rewritten ?? '');
    if (rw.includes('\r')) throw new Error(`LLM review output contains \\r for paragraph ${String(p.paragraph_id ?? '')}`);
  }
}

function validateAll(paras: RewritesForIndesignParagraph[], mode: RewriteLintMode) {
  // Per paragraph
  for (const p of paras) {
    const v = validateCombinedRewriteText(String(p.rewritten ?? ''));
    if (v.errors.length) throw new Error(`LLM review output failed validation for paragraph ${String(p.paragraph_id ?? '')}: ${v.errors.join(' | ')}`);
  }
  // Cross paragraph
  const cross = lintRewritesForIndesignJsonParagraphs(paras, { mode });
  if (cross.errors.length) throw new Error(`LLM review output failed JSON-level lint: ${cross.errors[0]}`);
}

function splitSemicolonItems(text: string): string[] {
  const s = String(text ?? '');
  const raw = s.split(';');
  const endsWithSemi = s.trim().endsWith(';');
  const items: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const part = String(raw[i] ?? '').trim();
    if (!part) continue;
    if (i < raw.length - 1) items.push(`${part};`);
    else items.push(endsWithSemi ? `${part};` : part);
  }
  return items;
}

function stripTrailingListPunct(s: string): string {
  let t = String(s ?? '').trim();
  t = t.replace(/^[•\-\u2022]\s*/g, '').trim();
  // Remove a single trailing semicolon/comma
  t = t.replace(/[;,\s]+$/g, '').trim();
  return t;
}

function inferLastPunctFromOriginalSemicolonList(original: string): string {
  const oItems = splitSemicolonItems(original);
  const last = String(oItems[oItems.length - 1] ?? '').trim();
  if (/[.!?]$/.test(last)) return last.slice(-1);
  if (/:$/.test(last)) return ':';
  return '.';
}

function joinSemicolonItems(items: string[], lastPunct: string): string {
  const cleaned = items.map((it) => stripTrailingListPunct(it));
  const out: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    let t = cleaned[i] ?? '';
    if (!t) t = '';
    if (i < cleaned.length - 1) {
      out.push(`${t};`);
    } else {
      // Ensure a sensible ending punctuation on the last item
      if (t && !/[.!?]$/.test(t)) t = `${t}${lastPunct || '.'}`;
      out.push(t);
    }
  }
  return out.join('');
}

type ReviewAction =
  | {
      type: 'keep';
      block: 'praktijk' | 'verdieping';
      from_paragraph_id: string;
      reason: string;
      confidence: number;
    }
  | {
      type: 'drop';
      block: 'praktijk' | 'verdieping';
      from_paragraph_id: string;
      reason: string;
      confidence: number;
    }
  | {
      type: 'move';
      block: 'praktijk' | 'verdieping';
      from_paragraph_id: string;
      to_paragraph_id: string;
      reason: string;
      confidence: number;
    };

type ReviewResponse = {
  actions: ReviewAction[];
  notes?: string;
};

type BulletRepairResponse = {
  items: string[];
  notes?: string;
};

async function repairBulletSemicolonListWithLLM(opts: {
  openai: OpenAI;
  model: string;
  section: SectionKey;
  listIntro: string;
  originalItems: string[];
  currentRewritten: string;
}): Promise<BulletRepairResponse> {
  const { openai, model, section, listIntro, originalItems, currentRewritten } = opts;
  const system = [
    `You are an expert Dutch editor for an educational textbook (basisboek / N3).`,
    `Task: rewrite a bullet list while preserving its STRUCTURE for deterministic publishing.`,
    ``,
    `You will receive:`,
    `- listIntro: the sentence that introduces the bullets (often ends with ':')`,
    `- originalItems: bullet items extracted from the source (each corresponds to a bullet paragraph)`,
    `- currentRewritten: a bad rewrite that lost bullet structure`,
    ``,
    `You must output STRICT JSON: { "items": [ ... ] } where:`,
    `- items.length MUST equal originalItems.length`,
    `- each item is the rewritten text for that bullet item ONLY`,
    `- do NOT include bullet characters, numbering, or newlines`,
    `- do NOT repeat the listIntro sentence (avoid redundancy like "Er zijn twee soorten..." inside items)`,
    `- keep meaning; simplify language; no new facts`,
    `- keep items concise (prefer <= 160 chars each when possible)`,
  ].join('\n');

  const user = {
    section,
    listIntro: truncate(listIntro, 420),
    originalItems: originalItems.map((x) => truncate(x, 260)),
    currentRewritten: truncate(currentRewritten, 420),
  };

  const resp = await withRetries(`llm(bullet_repair) ${section}`, () =>
    openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
    })
  );

  const txt = String(resp.choices?.[0]?.message?.content ?? '').trim();
  if (!txt) throw new Error(`LLM returned empty bullet repair response for section ${section}`);
  try {
    return JSON.parse(txt) as BulletRepairResponse;
  } catch {
    throw new Error(`LLM did not return valid JSON for bullet repair (section ${section}). Raw:\n${txt}`);
  }
}

function markerFor(block: 'praktijk' | 'verdieping'): string {
  return block === 'praktijk' ? PR_MARKER : VE_MARKER;
}

function hasBlock(parts: ReturnType<typeof parseCombined>, block: 'praktijk' | 'verdieping'): boolean {
  return block === 'praktijk' ? !!parts.praktijkLine : !!parts.verdiepingLine;
}

function removeBlock(parts: ReturnType<typeof parseCombined>, block: 'praktijk' | 'verdieping') {
  if (block === 'praktijk') parts.praktijkLine = null;
  else parts.verdiepingLine = null;
}

function setBlock(parts: ReturnType<typeof parseCombined>, block: 'praktijk' | 'verdieping', line: string | null) {
  if (block === 'praktijk') parts.praktijkLine = line;
  else parts.verdiepingLine = line;
}

function safeNumber(n: any, fallback: number) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function clamp01(n: any): number {
  return Math.max(0, Math.min(1, safeNumber(n, 0)));
}

function isSameSection(a: RewritesForIndesignParagraph, b: RewritesForIndesignParagraph): boolean {
  return (
    String(a.chapter ?? '') === String(b.chapter ?? '') &&
    String(a.paragraph_number ?? '') === String(b.paragraph_number ?? '') &&
    String(a.subparagraph_number ?? '') === String(b.subparagraph_number ?? '')
  );
}

async function reviewSectionWithLLM(opts: {
  openai: OpenAI;
  model: string;
  section: SectionKey;
  paragraphs: Array<{
    paragraph_id: string;
    style_name: string;
    base: string;
    praktijk: string | null;
    verdieping: string | null;
  }>;
}): Promise<ReviewResponse> {
  const { openai, model, section, paragraphs } = opts;

  const system = [
    `You are a meticulous human reviewer for a Dutch educational biology/health textbook.`,
    `You are DTP-aware: you must prevent "floating" blocks that break lists or topic flow.`,
    ``,
    `You are reviewing a single section (${section}). Each paragraph may contain optional layer blocks:`,
    `- praktijk block starts with exactly: ${PR_MARKER}`,
    `- verdieping block starts with exactly: ${VE_MARKER}`,
    ``,
    `Allowed actions (SAFE AUTOFIX ONLY):`,
    `- keep: keep the block where it is`,
    `- move: move an EXISTING block to another paragraph_id WITHIN THIS SAME SECTION only`,
    `- drop: remove an EXISTING block if placement is clearly harmful and no safe move target exists`,
    ``,
    `Rules:`,
    `- Do NOT create new educational content. Do NOT rewrite base text. Do NOT add new blocks.`,
    `- Do NOT change any paragraph_id, numbering, or order.`,
    `- Only move/drop blocks that already exist.`,
    `- If unsure, choose keep.`,
    `- Prefer move over drop when there's a clearly better paragraph in the same section.`,
    ``,
    `Praktijk / Verdieping quality + placement rules (high-signal):`,
    `- Praktijk must be concrete and nursing-like (signaal → actie → wanneer melden). Avoid generic tips.`,
    `- Verdieping must logically deepen the SAME concept (the “why/how”), without a topic jump.`,
    `- NEVER place praktijk/verdieping inside bullet/list paragraphs or headings.`,
    `- NEVER place praktijk/verdieping inside a list-intro paragraph that ends with ':' when the next paragraph(s) are bullets.`,
    `  If such a placement exists, move the block to a normal body paragraph AFTER the bullet run (same section).`,
    `- Do not change the marker text; keep ${PR_MARKER} and ${VE_MARKER} exactly (label bold-only + colon already included).`,
    ``,
    `Output STRICT JSON (no markdown), shape:`,
    `{ "actions": [ { "type": "keep|move|drop", "block":"praktijk|verdieping", "from_paragraph_id":"...", "to_paragraph_id":"..."?, "reason":"...", "confidence":0.0 } ], "notes":"..." }`,
  ].join('\n');

  const userPayload = {
    section,
    paragraphs: paragraphs.map((p, i) => ({
      i,
      paragraph_id: p.paragraph_id,
      style_name: p.style_name,
      base: truncate(p.base, 700),
      praktijk: p.praktijk ? truncate(p.praktijk, 360) : null,
      verdieping: p.verdieping ? truncate(p.verdieping, 360) : null,
    })),
  };

  const resp = await withRetries(`llm(review) ${section}`, () =>
    openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    })
  );

  const txt = String(resp.choices?.[0]?.message?.content ?? '').trim();
  if (!txt) throw new Error(`LLM returned empty response for section ${section}`);
  try {
    return JSON.parse(txt) as ReviewResponse;
  } catch (e) {
    throw new Error(`LLM did not return valid JSON for section ${section}. Raw:\n${txt}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const home = process.env.HOME || '';

  const defaultInFixed = path.join(home, 'Desktop', 'rewrites_for_indesign.FIXED_DRAFT.json');
  const defaultIn = fs.existsSync(defaultInFixed) ? defaultInFixed : path.join(home, 'Desktop', 'rewrites_for_indesign.json');

  const inPath = process.argv[2] && !process.argv[2]!.startsWith('--') ? path.resolve(expandTilde(process.argv[2]!)) : defaultIn;
  const outPath =
    process.argv[3] && !process.argv[3]!.startsWith('--')
      ? path.resolve(expandTilde(process.argv[3]!))
      : path.join(home, 'Desktop', 'rewrites_for_indesign.LLM_REVIEWED.json');

  const modeRaw = typeof args.mode === 'string' ? String(args.mode).trim().toLowerCase() : '';
  const mode: RewriteLintMode = modeRaw === 'indesign' ? 'indesign' : 'prince';

  const chapterFilter = typeof args.chapter === 'string' ? String(args.chapter).trim() : '';
  const dryRun = args['dry-run'] === true;
  const samplePages = typeof args['sample-pages'] === 'string' ? Math.max(0, parseInt(String(args['sample-pages']), 10) || 0) : 0;
  const wordsPerPage = typeof args['words-per-page'] === 'string' ? Math.max(200, parseInt(String(args['words-per-page']), 10) || 550) : 550;
  // Default to Claude Haiku 4.5 per project preference; override via --model if needed.
  const model = typeof args.model === 'string' ? String(args.model).trim() : 'claude-opus-4-5-20251101';

  if (!fs.existsSync(inPath)) throw new Error(`❌ Not found: ${inPath}`);

  const apiKey = String(process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) throw new Error(`❌ Missing OPENAI_API_KEY (required for LLM review).`);
  if (apiKey === 'your-openai-key') {
    throw new Error(
      `❌ OPENAI_API_KEY is still set to the placeholder value 'your-openai-key'.\n` +
        `Set a real key in your shell (recommended: export OPENAI_API_KEY=...) or update .env, then rerun.`
    );
  }
  const openai = new OpenAI({ apiKey });

  const raw = fs.readFileSync(inPath, 'utf8');
  const data = JSON.parse(raw) as JsonShape;
  if (!data || !Array.isArray(data.paragraphs)) throw new Error('❌ Invalid JSON: expected { paragraphs: [...] }');

  // Work on a deep copy
  const paras: RewritesForIndesignParagraph[] = JSON.parse(JSON.stringify(data.paragraphs));

  // Index by id
  const byId = new Map<string, RewritesForIndesignParagraph>();
  for (const p of paras) {
    const id = String(p.paragraph_id ?? '').trim();
    if (!id) continue;
    byId.set(id, p);
  }

  // Group by section
  const sections = new Map<SectionKey, RewritesForIndesignParagraph[]>();
  const sectionOrder: SectionKey[] = [];
  for (const p of paras) {
    if (chapterFilter && String(p.chapter ?? '') !== chapterFilter) continue;
    const key = sectionKey(p);
    const arr = sections.get(key) ?? [];
    arr.push(p);
    sections.set(key, arr);
    if (arr.length === 1) sectionOrder.push(key);
  }

  const selection = selectSectionKeysForSample({
    sectionOrder,
    sections,
    samplePages,
    wordsPerPage,
  });
  const sectionKeys = samplePages ? selection.keys : [...sections.keys()].sort();
  if (samplePages) {
    console.log(
      `sample_pages=${samplePages} words_per_page=${wordsPerPage} budget_words=${selection.budgetWords} ` +
        `selected_sections=${selection.sections} approx_words=${selection.approxWords}`
    );
  }

  const report: any = {
    inPath,
    outPath,
    chapter: chapterFilter || null,
    model,
    sample_pages: samplePages || null,
    sample_words_per_page: samplePages ? wordsPerPage : null,
    started_at: new Date().toISOString(),
    dry_run: dryRun,
    actions_applied: [] as any[],
    sections_reviewed: 0,
    blocks_seen: 0,
  };

  const run = async () => {
    for (const sk of sectionKeys) {
      const secParas = sections.get(sk) ?? [];
      if (!secParas.length) continue;

      // Only send to LLM if section contains at least one layer block
      let hasAny = false;
      const payloadParas: Array<{
        paragraph_id: string;
        style_name: string;
        base: string;
        praktijk: string | null;
        verdieping: string | null;
      }> = [];

      for (const p of secParas) {
        const id = String(p.paragraph_id ?? '').trim();
        if (!id) continue;
        const parts = parseCombined(String(p.rewritten ?? ''));
        const praktijk = parts.praktijkLine ? String(parts.praktijkLine) : null;
        const verdieping = parts.verdiepingLine ? String(parts.verdiepingLine) : null;
        if (praktijk || verdieping) hasAny = true;
        payloadParas.push({
          paragraph_id: id,
          style_name: String(p.style_name ?? ''),
          base: String(parts.base ?? ''),
          praktijk,
          verdieping,
        });
      }

      if (!hasAny) continue;
      report.sections_reviewed++;
      for (const pp of payloadParas) if (pp.praktijk || pp.verdieping) report.blocks_seen++;

      const rr = await reviewSectionWithLLM({
        openai,
        model,
        section: sk,
        paragraphs: payloadParas,
      });

      const actions = Array.isArray(rr.actions) ? rr.actions : [];
      if (!actions.length) continue;

      // Apply actions (SAFE: within same section only; must target existing blocks)
      for (const a of actions) {
        const type = String((a as any).type ?? '').trim();
        const block = String((a as any).block ?? '').trim() as 'praktijk' | 'verdieping';
        const fromId = String((a as any).from_paragraph_id ?? '').trim();
        const toId = String((a as any).to_paragraph_id ?? '').trim();
        const confidence = clamp01((a as any).confidence);
        const reason = String((a as any).reason ?? '').trim();

        if (!fromId || (block !== 'praktijk' && block !== 'verdieping')) continue;
        if (type !== 'keep' && type !== 'drop' && type !== 'move') continue;

        const from = byId.get(fromId);
        if (!from) continue;
        if (chapterFilter && String(from.chapter ?? '') !== chapterFilter) continue;

        const fromParts = parseCombined(String(from.rewritten ?? ''));
        if (!hasBlock(fromParts, block)) continue; // cannot act on non-existing block

        if (type === 'keep') {
          report.actions_applied.push({ section: sk, type, block, from_paragraph_id: fromId, reason, confidence });
          continue;
        }

        if (type === 'drop') {
          if (!dryRun) {
            removeBlock(fromParts, block);
            from.rewritten = buildCombined(fromParts);
          }
          report.actions_applied.push({ section: sk, type, block, from_paragraph_id: fromId, reason, confidence });
          continue;
        }

        // move
        if (!toId) continue;
        const to = byId.get(toId);
        if (!to) continue;
        if (!isSameSection(from, to)) continue; // strict safety: never move across section boundaries

        const toParts = parseCombined(String(to.rewritten ?? ''));
        if (hasBlock(toParts, block)) continue; // don't create duplicates

        // Extract block line from source
        const line = block === 'praktijk' ? fromParts.praktijkLine : fromParts.verdiepingLine;
        if (!line) continue;

        if (!dryRun) {
          // Remove from source
          removeBlock(fromParts, block);
          from.rewritten = buildCombined(fromParts);
          // Add to target (preserve marker exactness)
          setBlock(toParts, block, String(line));
          to.rewritten = buildCombined(toParts);
        }

        report.actions_applied.push({
          section: sk,
          type,
          block,
          from_paragraph_id: fromId,
          to_paragraph_id: toId,
          reason,
          confidence,
        });
      }
    }

    // LLM bullet parity repair is InDesign-only (deterministic apply contract).
    if (mode === 'indesign') {
      // If a bullet paragraph's original is a semicolon-list (>=2 items), but rewritten isn't,
      // call the LLM to produce per-item rewritten bullets so InDesign apply is deterministic.
      let bulletsRepaired = 0;
      for (let i = 0; i < paras.length; i++) {
        const p = paras[i]!;
        if (chapterFilter && String(p.chapter ?? '') !== chapterFilter) continue;
        const style = String(p.style_name ?? '');
        const isBullet = style.toLowerCase().includes('bullet') || style.toLowerCase().includes('_bullets') || style.toLowerCase().includes('•bullets');
        if (!isBullet) continue;

        const oItems = splitSemicolonItems(String(p.original ?? ''));
        if (oItems.length < 2) continue;
        const wItems = splitSemicolonItems(String(p.rewritten ?? ''));
        if (wItems.length === oItems.length) continue; // already structurally ok

        // Find a nearby list intro in the same section (scan backwards for first non-bullet paragraph)
        let intro = '';
        try {
          for (let j = i - 1; j >= 0; j--) {
            const prev = paras[j]!;
            if (!prev) continue;
            if (!isSameSection(prev, p)) break;
            const prevStyle = String(prev.style_name ?? '');
            const prevIsBullet =
              prevStyle.toLowerCase().includes('bullet') || prevStyle.toLowerCase().includes('_bullets') || prevStyle.toLowerCase().includes('•bullets');
            if (prevIsBullet) continue;
            intro = String(prev.rewritten ?? prev.original ?? '').trim();
            break;
          }
        } catch {}

        const repaired = await repairBulletSemicolonListWithLLM({
          openai,
          model,
          section: sectionKey(p),
          listIntro: intro,
          originalItems: oItems,
          currentRewritten: String(p.rewritten ?? ''),
        });

        const items = Array.isArray(repaired.items) ? repaired.items.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
        if (items.length !== oItems.length) {
          throw new Error(
            `LLM bullet repair produced wrong item count for paragraph ${String(p.paragraph_id ?? '')} (expected ${oItems.length}, got ${items.length})`
          );
        }

        const lastPunct = inferLastPunctFromOriginalSemicolonList(String(p.original ?? ''));
        if (!dryRun) {
          p.rewritten = joinSemicolonItems(items, lastPunct);
        }
        bulletsRepaired++;
        report.actions_applied.push({
          section: sectionKey(p),
          type: 'BULLET_REPAIR',
          block: 'praktijk',
          from_paragraph_id: String(p.paragraph_id ?? ''),
          to_paragraph_id: '',
          reason: 'Repaired semicolon bullet list via LLM to preserve per-item structure for deterministic apply.',
          confidence: 0.9,
        });
      }
      if (bulletsRepaired > 0) console.log(`LLM bullet repair: repaired ${bulletsRepaired} paragraph(s)`);
    }

    // Deterministic fix-up pass: move layer blocks out of list-intro paragraphs before bullet runs
    // This catches cases where the LLM placed a block in a bad location
    const { moves: detMoves, punctuation_changed, list_intro_restored, heading_spacing_normalized } = applyDeterministicFixesToParagraphs(paras, { mode });
    if (detMoves.length > 0) {
      console.log(`Deterministic fix-up: moved ${detMoves.length} layer block(s)`);
      for (const m of detMoves) {
        console.log(`  - ${m.from_id} → ${m.to_id ?? '(suppressed)'}: ${m.reason}`);
        report.actions_applied.push({
          section: 'deterministic',
          type: m.moved.praktijk && m.moved.verdieping ? 'MOVE_BOTH' : m.moved.praktijk ? 'MOVE_PRAKTIJK' : 'MOVE_VERDIEPING',
          block: m.moved.praktijk ? 'praktijk' : 'verdieping',
          from_paragraph_id: m.from_id,
          to_paragraph_id: m.to_id,
          reason: m.reason,
          confidence: 1.0,
        });
      }
    }
    if (list_intro_restored > 0) {
      console.log(`Deterministic fix-up: restored list-intro ':' on ${list_intro_restored} paragraph(s)`);
      report.actions_applied.push({
        section: 'deterministic',
        type: 'RESTORE_LIST_INTRO',
        block: 'praktijk',
        from_paragraph_id: '',
        to_paragraph_id: '',
        reason: "Restored list-intro ':' when followed by bullet runs (prevents 'floating' first bullet).",
        confidence: 1.0,
        count: list_intro_restored,
      });
    }
    if (heading_spacing_normalized > 0) {
      console.log(`Deterministic fix-up: normalized heading spacing on ${heading_spacing_normalized} paragraph(s)`);
      report.actions_applied.push({
        section: 'deterministic',
        type: 'NORMALIZE_HEADING_SPACING',
        block: 'praktijk',
        from_paragraph_id: '',
        to_paragraph_id: '',
        reason: "Normalized '\\n\\n' before layer headings inside paragraphs.",
        confidence: 1.0,
        count: heading_spacing_normalized,
      });
    }

    // Validate output (even in dry-run, to ensure the file would be safe)
    mustNoCarriageReturns(paras);
    validateAll(paras, mode);

    const out: JsonShape = {
      ...data,
      paragraphs: paras,
      llm_reviewed_at: new Date().toISOString(),
      llm_reviewed_by: 'scripts/llm-review-rewrites-json.ts',
      llm_review_report: {
        ...report,
        finished_at: new Date().toISOString(),
      },
    };

    if (!dryRun) {
      // Backup input next to output (cheap change control)
      try {
        const bak = `${outPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        fs.writeFileSync(bak, raw, 'utf8');
      } catch (e) {}

      fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
      console.log(`✅ Wrote LLM-reviewed JSON: ${outPath}`);
    } else {
      console.log(`(dry-run) ✅ LLM review completed. No file written.`);
    }

    console.log(`Sections reviewed: ${report.sections_reviewed}`);
    console.log(`Layer blocks seen: ${report.blocks_seen}`);
    console.log(`Actions: ${report.actions_applied.length}`);
  };

  run().catch((e) => {
    console.error(String(e?.stack || e));
    process.exit(1);
  });
}

main();


