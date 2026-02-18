/**
 * llm-skeleton-rewrite.ts
 *
 * Experimental "Skeleton → Fill" rewrite approach.
 * Tests whether extracting key facts first, then writing fresh prose, produces
 * better flowing text than direct paragraph-by-paragraph rewrites.
 *
 * Three phases:
 * 1. SKELETON: Extract key terms, facts, and logical flow from the section
 * 2. FILL: Write fresh N3-level Dutch prose covering those facts
 * 3. MAP: Align the fresh prose back to paragraph IDs
 *
 * Usage:
 *   npx ts-node scripts/llm-skeleton-rewrite.ts <canonical.json> --section 1.2 --out output.json
 *   npx ts-node scripts/llm-skeleton-rewrite.ts <canonical.json> --section 1.2 --model claude-opus-4-5-20251101
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { llmChatComplete, withRetries, type LlmProvider, type LlmChatMessage } from '../new_pipeline/lib/llm';

// Load env
try {
  const localPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(localPath)) dotenv.config({ path: localPath });
} catch {
  // ignore
}
dotenv.config();

// =============================================================================
// Types
// =============================================================================

type CanonicalSection = {
  number: string;
  title?: string;
  content: CanonicalBlock[];
};

type CanonicalBlock = {
  type: 'paragraph' | 'list' | 'steps' | 'subparagraph';
  id: string;
  number?: string;
  title?: string;
  basis?: string;
  items?: string[];
  content?: CanonicalBlock[];
  styleHint?: string;
  role?: string;
  images?: any[];
  praktijk?: string;
  verdieping?: string;
};

type SkeletonOutput = {
  terms: Array<{ term: string; definition: string }>;
  facts: string[];
  examples: string[];
  flow: string[];
};

// =============================================================================
// Prince-first text hygiene helpers (deterministic)
// =============================================================================

function inferBulletLevel(styleName: string | null | undefined): number {
  const s = String(styleName || '').toLowerCase();
  // Common patterns across canonical JSON
  const m1 = s.match(/\blvl\s*(\d+)\b/);
  if (m1) return Number(m1[1]) || 1;
  const m2 = s.match(/\bbullet[_\s]*lvl\s*(\d+)\b/);
  if (m2) return Number(m2[1]) || 1;
  if (s.includes('lvl 3') || s.includes('lvl3') || s.includes('bullet_lvl3')) return 3;
  if (s.includes('lvl 2') || s.includes('lvl2') || s.includes('bullet_lvl2')) return 2;
  if (s.includes('bullets') || s.includes('bullet')) return 1;
  return 0;
}

function fixSpacesAroundBoldMarkers(t: string): string {
  let s = String(t || '');
  // Missing space BEFORE a bold marker (e.g., "de<<BOLD_START>>glycocalyx")
  s = s.replace(/([0-9A-Za-zÀ-ÖØ-öø-ÿ])<<BOLD_START>>/gu, '$1 <<BOLD_START>>');
  // Missing space AFTER a bold marker end (e.g., "<<BOLD_END>>is")
  s = s.replace(/<<BOLD_END>>([0-9A-Za-zÀ-ÖØ-öø-ÿ])/gu, '<<BOLD_END>> $1');
  // Missing space after punctuation before a bold marker (e.g., ",<<BOLD_START>>term")
  s = s.replace(/([,;:!?])<<BOLD_START>>/g, '$1 <<BOLD_START>>');
  s = s.replace(/([.])<<BOLD_START>>/g, '$1 <<BOLD_START>>');
  return s;
}

function fixMissingSpaceAfterSentencePunct(t: string): string {
  // e.g. "onderdelen.Om" -> "onderdelen. Om"
  // Keep conservative: only when next is an UPPERCASE letter (so we won't touch decimals like 7.5).
  return String(t || '').replace(/([0-9A-Za-zÀ-ÖØ-öø-ÿ])([.!?])([A-ZÀ-ÖØ-Þ])/gu, '$1$2 $3');
}

function fixBadSentenceSplitsBeforePrepositions(t: string): string {
  // Common LLM failure mode after "one fact per sentence":
  // "Deze laag zorgt. voor bescherming ..." -> should be "zorgt voor bescherming ..."
  //
  // We treat a sentence boundary before a LOWERCASE preposition as invalid and remove the period.
  const preps = [
    'voor',
    'van',
    'met',
    'in',
    'op',
    'aan',
    'bij',
    'uit',
    'naar',
    'over',
    'door',
    'om',
    'tot',
    'tegen',
    'zonder',
    'binnen',
    'buiten',
  ];
  // IMPORTANT: do NOT use /i here — a new sentence can legitimately start with "Voor/In/Bij...".
  // We only remove the period when the preposition is lowercase in the source text.
  const re = new RegExp(`\\.(\\s+)(?:${preps.join('|')})\\b`, 'gu');
  // Replace ". <prep>" with " <prep>"
  return String(t || '').replace(re, (m) => m.replace('.', '').replace(/\s+/, ' '));
}

function sanitizePrinceRewriteText(raw: string): string {
  let t = String(raw || '');
  // Normalize line breaks and collapse to spaces (Prince renderer uses flowing paragraphs).
  t = t.replace(/\r/g, '\n').replace(/\n+/g, ' ');
  t = fixSpacesAroundBoldMarkers(t);
  t = fixMissingSpaceAfterSentencePunct(t);
  t = fixBadSentenceSplitsBeforePrepositions(t);
  // Normalize whitespace
  t = t.replace(/[ \t]+/g, ' ').trim();
  return t;
}

function extractLeadingPrepositionSentence(raw: string): { sentence: string; rest: string } | null {
  // If a block starts with a lowercase preposition, it might be a fragment that belongs to the previous sentence,
  // e.g. previous: "De glycocalyx zorgt." next: "voor bescherming ... . Je afweersysteem ..."
  const s = String(raw || '').trimStart();
  if (!s) return null;

  const preps = [
    'voor',
    'van',
    'met',
    'in',
    'op',
    'aan',
    'bij',
    'uit',
    'naar',
    'over',
    'door',
    'om',
    'tot',
    'tegen',
    'zonder',
    'binnen',
    'buiten',
  ];
  const pre = preps.find((p) => s.startsWith(`${p} `) || s === p || s.startsWith(`${p},`) || s.startsWith(`${p}.`));
  if (!pre) return null;

  // Take until the end of the first sentence ('.' / '!' / '?') if present.
  const m = s.match(/^[\s\S]*?[.!?]/u);
  if (!m) return null;
  const sentence = m[0].trim();
  const rest = s.slice(m[0].length).trimStart();
  if (!sentence) return null;
  return { sentence, rest };
}

type ErrataRule = {
  id: string;
  severity: 'error' | 'warn';
  description?: string;
  regex: string;
  flags?: string;
  fix_notes?: string[];
};

type ErrataPack = {
  version?: number;
  rules?: ErrataRule[];
};

type CompiledErrataRule = {
  rule: ErrataRule;
  re: RegExp;
};

type FillOutput = {
  prose: string;
  paragraph_breaks: string[]; // Natural break points in the prose
};

type MappedParagraph = {
  paragraph_id: string;
  original_summary: string;
  rewritten: string;
};

type OutputJson = {
  book_title: string;
  section: string;
  generated_at: string;
  method: string;
  skeleton: SkeletonOutput;
  fresh_prose: string;
  paragraphs: Array<{
    paragraph_id: string;
    chapter: string;
    style_name: string;
    original: string;
    rewritten: string;
  }>;
};

function stripInlineMarkersForMatch(s: string): string {
  return String(s || '')
    .replace(/<<BOLD_START>>/g, '')
    .replace(/<<BOLD_END>>/g, '')
    .replace(/<<MICRO_TITLE>>/g, '')
    .replace(/<<MICRO_TITLE_END>>/g, '')
    .replace(/\u00ad/g, '') // soft hyphen
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveErrataPathFromCwd(explicitPath?: string): string | null {
  const p = String(explicitPath || '').trim();
  if (p) {
    const abs = path.resolve(p);
    return fs.existsSync(abs) ? abs : null;
  }
  const candidates = [
    // When run from new_pipeline/ as cwd
    path.resolve(process.cwd(), 'validate/factual_errata.json'),
    // When run from repo root as cwd
    path.resolve(process.cwd(), 'new_pipeline/validate/factual_errata.json'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

function loadErrataPack(errataPath: string | null): ErrataPack | null {
  if (!errataPath) return null;
  try {
    return JSON.parse(fs.readFileSync(errataPath, 'utf8')) as ErrataPack;
  } catch {
    return null;
  }
}

function compileErrataRules(pack: ErrataPack | null): CompiledErrataRule[] {
  const rules = Array.isArray(pack?.rules) ? (pack!.rules as ErrataRule[]) : [];
  const compiled: CompiledErrataRule[] = [];
  for (const r of rules) {
    if (!r || !r.id || !r.regex) continue;
    try {
      const re = new RegExp(String(r.regex), String(r.flags || 'iu'));
      compiled.push({ rule: r, re });
    } catch {
      // ignore invalid regex
    }
  }
  return compiled;
}

function findErrataMatches(textRaw: string, compiled: CompiledErrataRule[]): ErrataRule[] {
  if (!compiled.length) return [];
  const text = stripInlineMarkersForMatch(textRaw);
  if (!text) return [];
  const hits: ErrataRule[] = [];
  for (const { rule, re } of compiled) {
    try {
      if (re.test(text)) hits.push(rule);
    } catch {
      // ignore
    }
  }
  return hits;
}

// =============================================================================
// LLM Infrastructure (shared)
// =============================================================================

function stripMarkdownCodeFences(s: string): string {
  let t = String(s ?? '').trim();
  // Remove opening fence with optional language tag
  t = t.replace(/^```(?:json|JSON)?\s*\n?/, '');
  // Remove closing fence
  t = t.replace(/\n?```\s*$/, '');
  return t.trim();
}

function parseModelJson<T>(raw: string, label: string): T {
  const txt = stripMarkdownCodeFences(raw);
  if (!txt) throw new Error(`${label}: empty response`);
  try {
    return JSON.parse(txt) as T;
  } catch {
    // Try to extract JSON from noisy response
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(txt.slice(start, end + 1)) as T;
      } catch {
        // fall through
      }
    }
  }
  throw new Error(`${label}: did not return valid JSON. Raw:\n${raw.trim()}`);
}

// =============================================================================
// Phase 1: SKELETON - Extract key facts and terms
// =============================================================================

const SKELETON_SYSTEM_PROMPT = `You are analyzing a Dutch educational textbook section (MBO N3 level, biology/anatomy).

Extract ALL information from this section - be EXHAUSTIVE.

Output STRICT JSON:
{
  "terms": [
    { "term": "Dutch term", "definition": "Full definition in Dutch (2-3 sentences if needed)" }
  ],
  "facts": [
    "Complete factual statement with all details",
    "Another complete fact..."
  ],
  "examples": [
    "Any examples, comparisons, or analogies used",
    "Another example..."
  ],
  "flow": [
    "Step 1: First concept introduced",
    "Step 2: What builds on step 1",
    "..."
  ]
}

RULES:
- Extract EVERY technical term, even minor ones
- Extract EVERY fact with FULL detail (numbers, specifics, relationships)
- Extract ALL examples and comparisons (e.g., "like a zipper", "similar to a recipe")
- Capture the complete teaching progression
- Definitions should be complete, not abbreviated
- If a fact mentions specific items (A, B, C, D), list them all
- Do NOT summarize - preserve all information`;

async function extractSkeleton(opts: {
  provider: LlmProvider;
  model: string;
  openai?: OpenAI;
  anthropicApiKey?: string;
  sectionText: string;
  sectionNumber: string;
}): Promise<SkeletonOutput> {
  const { provider, model, openai, anthropicApiKey, sectionText, sectionNumber } = opts;

  const userPrompt = `Extract the skeleton from this educational section (${sectionNumber}):

---
${sectionText}
---

Output STRICT JSON with terms, facts, and flow.`;

  const response = await withRetries(`skeleton(${sectionNumber})`, () =>
    llmChatComplete({
      provider,
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SKELETON_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      openai,
      anthropicApiKey,
      maxTokens: 16384, // Large sections need more tokens
    })
  );

  return parseModelJson<SkeletonOutput>(response, `skeleton(${sectionNumber})`);
}

// =============================================================================
// Phase 2: FILL - Write fresh prose from skeleton
// =============================================================================

const FILL_SYSTEM_PROMPT = `You are writing Dutch educational content for MBO N3 level students (age 16-20, practical healthcare training).

CRITICAL: Write like a REAL Dutch MBO N3 textbook. These books are SHORT and DIRECT.

STYLE - Copy this EXACT pattern from real N3 textbooks:
- "Dit zijn deeltjes die bestaan uit vettige en waterige stoffen."
- "Deze zorgen samen dat stoffen die bestaan uit water of vet niet zomaar door de celmembraan heen gaan."
- "Dit is een dun vliesje. Het is de grens tussen de binnenkant en de buitenkant van je cellen."

1. SENTENCES: SHORT and DIRECT
   - ONE fact per sentence. Then STOP.
   - BAD: "Deze bijzondere deeltjes zorgen ervoor dat jouw celmembraan goed werkt als beschermlaag."
   - GOOD: "Dit zijn deeltjes die bestaan uit vettige en waterige stoffen."
   - NO elaboration, NO "bijzondere", NO "namelijk", NO extra context

2. VOICE: Simple "je" (not "jouw")
   - Say "in je cellen" not "in jouw cellen"
   - Say "je lichaam" not "jouw lichaam"
   - Use "we" for introducing terms: "We noemen dit..."

3. LENGTH: MATCH the original EXACTLY
   - If original = 50 words, write ~50 words
   - Do NOT expand or elaborate
   - Do NOT add examples unless the original had them

4. TERMS: Simple introduction
   - "Dit noemen we de celmembraan."
   - "We noemen dit het cytoplasma."
   - Bold markers: <<BOLD_START>>term<<BOLD_END>>

5. FORBIDDEN - These make text TOO LONG:
   - "namelijk" (almost never needed)
   - "bijzondere" / "belangrijke" / "speciale" (avoid adjectives)
   - "Dit betekent dat..." (just state the fact)
   - "Hierdoor..." (avoid connector overuse)
   - Repeating information in different words
   - Adding context the original didn't have

6. STRUCTURE:
   - Fact. Fact. Fact. (short sentences)
   - Paragraph break only when topic changes
   - Lists for parallel items only

Terminology:
- Use "zorgvrager" (never cliënt/client)
- Use "zorgprofessional" (never verpleegkundige)

SPECIAL BLOCKS - "In de praktijk" and "Verdieping":
- Format: \\n\\n<<BOLD_START>>In de praktijk:<<BOLD_END>> text here...
- Format: \\n\\n<<BOLD_START>>Verdieping:<<BOLD_END>> text here...
- ONLY the label is bold (not the text after the colon)
- Colon is REQUIRED after the label
- Text after colon starts LOWERCASE (except abbreviations like DNA, AB0, ATP)
- NEVER place these inside a list-intro paragraph that ends with ":"
- Place these in a normal body paragraph AFTER any bullet runs
- IMPORTANT: Do NOT add "In de praktijk" / "Verdieping" blocks unless they already exist in the original input text you are rewriting.

Output: Write CONCISE Dutch prose matching the original length. Use "\\n\\n" between paragraphs.`;

async function writeFreshProse(opts: {
  provider: LlmProvider;
  model: string;
  openai?: OpenAI;
  anthropicApiKey?: string;
  skeleton: SkeletonOutput;
  sectionNumber: string;
  sectionTitle: string;
  originalWordCount: number;
}): Promise<string> {
  const { provider, model, openai, anthropicApiKey, skeleton, sectionNumber, sectionTitle, originalWordCount } = opts;

  const targetWords = Math.round(originalWordCount * 0.95); // Match or slightly SHORTER than original

  const examplesSection = skeleton.examples?.length
    ? `\nSKELETON - Examples (use ONLY if original had them):\n${skeleton.examples.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
    : '';

  const userPrompt = `Write a N3-level Dutch textbook section. Be CONCISE like a real MBO textbook.

Section: ${sectionNumber} ${sectionTitle}
TARGET LENGTH: ~${targetWords} words (same as original, NOT longer)

SKELETON - Terms to mark with <<BOLD_START>>term<<BOLD_END>>:
${skeleton.terms.map((t) => `- ${t.term}: ${t.definition}`).join('\n')}

SKELETON - Facts to state (ONE sentence per fact, no elaboration):
${skeleton.facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}
${examplesSection}

SKELETON - Topic order:
${skeleton.flow.map((s, i) => `${i + 1}. ${s}`).join('\n')}

CRITICAL REQUIREMENTS:
1. LENGTH: Write ~${targetWords} words. NOT MORE. Shorter is better than longer.
2. VOICE: Use "je" (not "jouw"). Use "we" for introductions.
3. SENTENCES: ONE fact per sentence. No elaboration. No "namelijk".
4. TERMS: "Dit noemen we..." or "We noemen dit..." pattern.
5. NO FILLER: No "bijzondere", no "belangrijke", no extra adjectives.
6. STRUCTURE: Fact. Fact. Fact. Short sentences. Direct.

Write now. Be CONCISE.`;

  const response = await withRetries(`fill(${sectionNumber})`, () =>
    llmChatComplete({
      provider,
      model,
      temperature: 0.4, // Slightly higher for more creative writing
      messages: [
        { role: 'system', content: FILL_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      openai,
      anthropicApiKey,
      maxTokens: 8192,
    })
  );

  // Strip any trailing JSON metadata block
  let prose = response;
  const jsonStart = prose.lastIndexOf('```json');
  if (jsonStart > 0) {
    prose = prose.slice(0, jsonStart).trim();
  }

  return prose;
}

// =============================================================================
// Phase 2+3 COMBINED: Write each paragraph fresh with full context
// =============================================================================

const PARAGRAPH_WRITER_SYSTEM = `You are rewriting ONE paragraph of a Dutch educational textbook (MBO N3 level).

CRITICAL: Write like a REAL Dutch N3 textbook - SHORT and DIRECT sentences.

EXAMPLE OF CORRECT N3 STYLE:
- "Dit zijn deeltjes die bestaan uit vettige en waterige stoffen."
- "Deze zorgen samen dat stoffen niet zomaar door de celmembraan heen gaan."
- "Dit is een dun vliesje. Het is de grens tussen de binnenkant en buitenkant van je cellen."

RULES:
1. SAME TOPICS: Cover the EXACT same content as the original. No new topics.
2. SAME LENGTH: Match the original word count. Do NOT make it longer.
3. SHORT SENTENCES: One fact per sentence, but each sentence must be grammatically complete (no fragments).
4. VOICE: Use "je" (not "jouw"). Use "we" for introductions.
5. NO FILLER: No "namelijk", no "bijzondere", no "belangrijke", no extra adjectives.
6. TERMS: "Dit noemen we..." pattern. Do NOT introduce new inline bold markers (<<BOLD_START>>...<<BOLD_END>>) unless they already exist in the original paragraph.

FORMAT:
- If the original block is a bullet/list: you may EITHER keep it as a short list OR rewrite it as a normal paragraph.
  - Prefer a normal paragraph if items are long/explanatory (Prince-first).
  - If you keep it as a list, separate items with semicolons.
- If the original ends with ":" (list-intro), keep ":" only if the next block remains a list; otherwise you may end normally.
- NEVER output broken splits like "zorgt. voor ..." — write "zorgt voor ...".

SPECIAL BLOCKS - "In de praktijk" and "Verdieping":
- Format: \\n\\n<<BOLD_START>>In de praktijk:<<BOLD_END>> text starts here lowercase...
- Format: \\n\\n<<BOLD_START>>Verdieping:<<BOLD_END>> text starts here lowercase...
- ONLY the label is bold, colon required, text after colon lowercase
- Exception: abbreviations (DNA, AB0, ATP) stay uppercase after colon
- IMPORTANT: Do NOT add "In de praktijk" / "Verdieping" blocks unless they already exist in the original paragraph text.

FORBIDDEN:
- Making the paragraph LONGER than the original
- Adding "namelijk" or connector overuse
- Adding examples the original didn't have
- Elaborating or explaining more than the original did

Output ONLY the rewritten paragraph text.`;

async function writeParagraphByParagraph(opts: {
  provider: LlmProvider;
  model: string;
  openai?: OpenAI;
  anthropicApiKey?: string;
  skeleton: SkeletonOutput;
  originalParagraphs: OriginalParagraph[];
  flatBlocks: CanonicalBlock[];
  sectionNumber: string;
  sectionTitle: string;
  errataCompiled?: CompiledErrataRule[];
  maxRepair?: number;
  mode: RewriteMode;
}): Promise<MappedParagraph[]> {
  const {
    provider,
    model,
    openai,
    anthropicApiKey,
    skeleton,
    originalParagraphs,
    flatBlocks,
    sectionNumber,
    sectionTitle,
    errataCompiled,
    maxRepair,
    mode,
  } = opts;

  const results: MappedParagraph[] = [];
  const previousParagraphs: string[] = [];

  // Build a map of which terms/facts belong to which paragraph (approximate)
  const termsString = skeleton.terms.map(t => `- <<BOLD_START>>${t.term}<<BOLD_END>>: ${t.definition}`).join('\n');
  const factsString = skeleton.facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
  const examplesString = skeleton.examples?.length 
    ? skeleton.examples.map((e, i) => `${i + 1}. ${e}`).join('\n')
    : 'None provided';

  for (let i = 0; i < originalParagraphs.length; i++) {
    const para = originalParagraphs[i];
    const block = flatBlocks.find(b => b.id === para.paragraph_id);
    const originalText = extractTextFromBlock(block || {} as CanonicalBlock);
    const originalWordCount = countWords(originalText);
    const targetWords = originalWordCount; // Match original length exactly - N3 is CONCISE

    // Find terms that appear IN THIS SPECIFIC original paragraph
    const originalLower = originalText.toLowerCase();
    const relevantTerms = skeleton.terms.filter(t => 
      originalLower.includes(t.term.toLowerCase())
    );
    
    // Find examples that might be relevant (mentioned in original)
    const relevantExamples = (skeleton.examples || []).filter(e =>
      originalLower.includes(e.toLowerCase().split(' ')[0]) || 
      originalLower.includes(e.toLowerCase().split(' ').slice(-1)[0])
    );

    // Build term definitions for only the relevant terms
    const relevantTermsStr = relevantTerms.length > 0
      ? `\nTERMS IN THIS PARAGRAPH (use these definitions):\n${relevantTerms.map(t => `- ${t.term}: ${t.definition}`).join('\n')}`
      : '';

    const relevantExamplesStr = relevantExamples.length > 0
      ? `\nEXAMPLES YOU MAY USE:\n${relevantExamples.join('\n')}`
      : '';

    // Factual errata: if the source paragraph contains known hard errors, we explicitly instruct the model to correct them.
    const errataHitsOriginal = errataCompiled?.length
      ? findErrataMatches(originalText, errataCompiled).filter((r) => r.severity === 'error')
      : [];
    const errataFixStr = errataHitsOriginal.length
      ? `\n\nFACTUAL CORRECTIONS REQUIRED (the original contains known mistakes):\n${errataHitsOriginal
          .map((r) => {
            const notes = Array.isArray(r.fix_notes) ? r.fix_notes : [];
            const lines = [
              `- ${r.id}${r.description ? `: ${r.description}` : ''}`,
              ...notes.map((n) => `  - ${n}`),
            ];
            return lines.join('\n');
          })
          .join('\n')}\n\nIMPORTANT: Apply these corrections even if it changes numbers/units/names. Do NOT mention that you corrected anything.`
      : '';

    // Track what's been covered to prevent duplication
    let alreadyCoveredContext = '';
    if (previousParagraphs.length > 0) {
      // Get terms already introduced
      const allPrevText = previousParagraphs.join(' ').toLowerCase();
      const termsAlreadyIntroduced = skeleton.terms
        .filter(t => allPrevText.includes(t.term.toLowerCase()))
        .map(t => t.term);
      
      if (termsAlreadyIntroduced.length > 0) {
        alreadyCoveredContext = `\nALREADY EXPLAINED (do not re-explain these terms):
${termsAlreadyIntroduced.slice(-15).map(t => `- ${t}`).join('\n')}`;
      }
      
      // Add last paragraph for flow context
      const lastPara = previousParagraphs[previousParagraphs.length - 1];
      alreadyCoveredContext += `\n\nPREVIOUS PARAGRAPH ENDED WITH:
"...${lastPara.slice(-150)}"`;
    }

    const userPrompt = `Rewrite this paragraph for section ${sectionNumber} "${sectionTitle}".

ORIGINAL:
"""
${originalText}
"""

CRITICAL - Match N3 style:
- SAME topics, SAME length (~${targetWords} words, NOT longer)
- SHORT sentences. One fact per sentence, but every sentence must be complete (no fragments).
- Use "je" (not "jouw"). Use "we" for introductions.
- NO "namelijk", NO extra adjectives, NO elaboration
${para.ends_with_colon ? (mode === 'indesign' ? '- Ends with ":" → your output MUST also end with ":"' : '- Original ends with ":" (list-intro). Keep ":" only if the next block remains a list; otherwise you may end normally.') : ''}
${para.is_list ? (mode === 'indesign'
  ? `- BULLET/LIST block (${para.list_item_count} items) → semicolon-separated items (keep the same item count)`
  : `- This block was a bullet/list in the original (${para.list_item_count} items).\n  You may EITHER:\n  A) Keep it as a short semicolon list (only if items are short/parallel)\n  B) Rewrite as ONE normal paragraph (preferred for long/explanatory items; avoid semicolons)`) : ''}
${relevantTermsStr}
${alreadyCoveredContext}
${errataFixStr}

${(() => {
  // Nested list context (prevents duplication like "mensen, dieren..." in a parent line + repeated as a nested list)
  const curLvl = inferBulletLevel(para.style_name);
  const next = i + 1 < originalParagraphs.length ? originalParagraphs[i + 1] : null;
  const nextLvl = next ? inferBulletLevel(next.style_name) : 0;
  if (para.is_list && next?.is_list && nextLvl > curLvl && curLvl > 0) {
    return `\nIMPORTANT:\n- The next block is a nested list of examples (level ${nextLvl}). Do NOT inline those example items in this block.\n- End with ':' to introduce the nested list, and stop.`;
  }
  if (para.is_list && curLvl >= 2 && mode === 'prince') {
    return `\nIMPORTANT:\n- This is a nested list (level ${curLvl}). Keep it as short semicolon items (do NOT rewrite as prose).`;
  }
  return '';
})()}

Rewrite (be CONCISE):`;

    const response = await withRetries(`para-${i + 1}`, () =>
      llmChatComplete({
        provider,
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: PARAGRAPH_WRITER_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        openai,
        anthropicApiKey,
        maxTokens: 1024,
      })
    );

    let rewritten = response.trim();
    
    // Clean up any markdown or extra formatting
    rewritten = rewritten.replace(/^["']|["']$/g, '').trim();
    if (rewritten.startsWith('```')) {
      rewritten = stripMarkdownCodeFences(rewritten);
    }

    // Prince mode: deterministic text hygiene to prevent common LLM artifacts:
    // - marker glue: "de<<BOLD_START>>term"
    // - sentence glue / fragments: "zorgt. voor ..."
    // - missing space after punctuation: "woord.Zin"
    if (mode === 'prince') {
      rewritten = sanitizePrinceRewriteText(rewritten);
    } else {
      // InDesign mode: keep line semantics, but still prevent accidental blank-line splits unless layer markers exist.
      const hasLayerMarker =
        rewritten.includes('<<BOLD_START>>In de praktijk:<<BOLD_END>>') || rewritten.includes('<<BOLD_START>>Verdieping:<<BOLD_END>>');
      if (!hasLayerMarker) {
        rewritten = rewritten
          .replace(/\r/g, '\n')
          .replace(/\n\s*\n+/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .trim();
      }
    }

    // Post-check against errata rules. If we still violate, iteratively repair a few times.
    const repairBudget = Math.max(0, Math.min(5, Math.floor(Number(maxRepair ?? 3))));
    for (let attempt = 0; attempt < repairBudget; attempt++) {
      const violations = errataCompiled?.length
        ? findErrataMatches(rewritten, errataCompiled).filter((r) => r.severity === 'error')
        : [];
      if (!violations.length) break;

      const violStr = violations
        .map((r) => {
          const notes = Array.isArray(r.fix_notes) ? r.fix_notes : [];
          const lines = [
            `- ${r.id}${r.description ? `: ${r.description}` : ''}`,
            ...notes.map((n) => `  - ${n}`),
          ];
          return lines.join('\n');
        })
        .join('\n');

      const repairPrompt = `The paragraph still violates factual errata rules.\n\nORIGINAL PARAGRAPH:\n\"\"\"\n${originalText}\n\"\"\"\n\nCURRENT REWRITE:\n\"\"\"\n${rewritten}\n\"\"\"\n\nVIOLATIONS TO FIX:\n${violStr}\n\nRules:\n- Fix ONLY these violations\n- Keep the same topic(s) and paragraph style\n- Keep \"je/jouw\" voice\n- Do NOT introduce KD or KD codes\n- Output ONLY the corrected paragraph text (no explanations)\n\nWrite the corrected paragraph now:`;

      const repaired = await withRetries(`para-${i + 1}-repair-${attempt + 1}`, () =>
        llmChatComplete({
          provider,
          model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: PARAGRAPH_WRITER_SYSTEM },
            { role: 'user', content: repairPrompt },
          ],
          openai,
          anthropicApiKey,
          maxTokens: 1024,
        })
      );

      rewritten = String(repaired || '').trim().replace(/^["']|["']$/g, '').trim();
      if (rewritten.startsWith('```')) rewritten = stripMarkdownCodeFences(rewritten);
      if (mode === 'prince') rewritten = sanitizePrinceRewriteText(rewritten);
    }

    results.push({
      paragraph_id: para.paragraph_id,
      original_summary: para.content_summary,
      rewritten,
    });

    previousParagraphs.push(rewritten);
    
    process.stdout.write(`   ✓ Paragraph ${i + 1}/${originalParagraphs.length} (${countWords(rewritten)} words)\n`);
  }

  // Post-pass (Prince-first): if a list-intro ends with ':' but the following list block was rewritten as prose,
  // remove the trailing ':' for better flow. If the next block is still a multi-item semicolon list, keep ':'.
  if (mode === 'prince') {
    const looksLikeSemicolonList = (s: string): boolean => {
      const parts = String(s || '')
        .split(';')
        .map((x) => x.trim())
        .filter(Boolean);
      return parts.length >= 2;
    };

    // Cross-block glue fix: prevent sentence fragments split across blocks, e.g.:
    // prev: "De glycocalyx zorgt." next: "voor bescherming ... . Je afweersysteem ..."
    // We move the first (preposition-starting) sentence from next into prev.
    for (let i = 0; i < results.length - 1; i++) {
      const curOut = results[i];
      const nextOut = results[i + 1];
      if (!curOut || !nextOut) continue;

      const curTrim = String(curOut.rewritten || '').trim();
      if (!curTrim.endsWith('.')) continue;

      const lead = extractLeadingPrepositionSentence(String(nextOut.rewritten || ''));
      if (!lead) continue;
      if (!lead.rest) continue; // don't delete the whole next block

      const merged = `${curTrim.replace(/\.\s*$/u, '').trim()} ${lead.sentence}`.trim();
      curOut.rewritten = sanitizePrinceRewriteText(merged);
      nextOut.rewritten = sanitizePrinceRewriteText(lead.rest);
    }

    for (let i = 0; i < originalParagraphs.length - 1; i++) {
      const cur = originalParagraphs[i];
      const next = originalParagraphs[i + 1];
      if (!cur?.ends_with_colon) continue;
      if (!next?.is_list) continue;

      const curOut = results[i];
      const nextOut = results[i + 1];
      if (!curOut || !nextOut) continue;

      const curTrim = String(curOut.rewritten || '').trim();
      const nextIsStillList = looksLikeSemicolonList(String(nextOut.rewritten || ''));

      if (nextIsStillList) {
        if (curTrim && !curTrim.endsWith(':')) {
          // Conservative: if it ends with '.', replace with ':', else append ':'
          let fixed = curTrim.replace(/[.。]\s*$/u, ':');
          fixed = fixed.replace(/:+$/u, ':');
          if (!fixed.endsWith(':')) fixed = `${fixed}:`;
          curOut.rewritten = fixed;
        }
      } else {
        if (curTrim.endsWith(':')) {
          curOut.rewritten = curTrim.replace(/:\s*$/u, '.');
        }
      }
    }
  }

  return results;
}

// =============================================================================
// Phase 3: MAP - Align prose back to paragraph IDs (LEGACY - kept for reference)
// =============================================================================

const MAP_SYSTEM_PROMPT = `You are splitting fresh prose into paragraph chunks that match original paragraph IDs.

CRITICAL: Preserve ALL content from the fresh prose. Do NOT summarize or shorten.

Rules:
1. Every paragraph_id MUST get a chunk of the fresh prose
2. The chunks together must contain ALL words from the fresh prose (no content loss!)
3. Match topics: each chunk covers the same topics as the original paragraph
4. Preserve order exactly
5. For BULLET lists (style contains "Bullets"): format as "item1; item2; item3."
6. If original ends with ":", the rewritten MUST also end with ":" (introduces next list)
7. Keep the "je/jouw" voice and <<BOLD_START>>terms<<BOLD_END>> from the fresh prose

FORBIDDEN:
- Summarizing or shortening any chunk
- Dropping content between chunks
- Changing "je" to formal language
- Removing <<BOLD_START>>..<<BOLD_END>> markers

Output STRICT JSON:
{
  "mappings": [
    {
      "paragraph_id": "uuid-here",
      "rewritten": "Full chunk of prose for this paragraph, preserving all content..."
    }
  ]
}`;

type OriginalParagraph = {
  paragraph_id: string;
  style_name: string;
  content_summary: string;
  ends_with_colon: boolean;
  is_list: boolean;
  list_item_count?: number;
};

type RewriteMode = 'prince' | 'indesign';

async function mapProseToIds(opts: {
  provider: LlmProvider;
  model: string;
  openai?: OpenAI;
  anthropicApiKey?: string;
  freshProse: string;
  originalParagraphs: OriginalParagraph[];
  sectionNumber: string;
}): Promise<MappedParagraph[]> {
  const { provider, model, openai, anthropicApiKey, freshProse, originalParagraphs, sectionNumber } = opts;

  const paragraphDescriptions = originalParagraphs.map((p, i) => {
    let desc = `${i + 1}. ID: ${p.paragraph_id}\n   Style: ${p.style_name}\n   Topics: ${p.content_summary}`;
    if (p.ends_with_colon) desc += '\n   NOTE: Original ends with ":" (introduces a list)';
    if (p.is_list) desc += `\n   NOTE: This is a BULLET LIST with ${p.list_item_count} items - use semicolons`;
    return desc;
  });

  const userPrompt = `Split this fresh prose into chunks matching these original paragraph IDs.

FRESH PROSE:
---
${freshProse}
---

ORIGINAL PARAGRAPHS TO MATCH (in order):
${paragraphDescriptions.join('\n\n')}

Output JSON with "mappings" array containing paragraph_id and rewritten for each.
CRITICAL: You MUST output exactly ${originalParagraphs.length} mappings, one for each paragraph_id listed above.`;

  const response = await withRetries(`map(${sectionNumber})`, () =>
    llmChatComplete({
      provider,
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: MAP_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      openai,
      anthropicApiKey,
      maxTokens: 8192,
    })
  );

  const parsed = parseModelJson<{ mappings: MappedParagraph[] }>(response, `map(${sectionNumber})`);
  return parsed.mappings || [];
}

// =============================================================================
// Helpers
// =============================================================================

function extractTextFromBlock(block: CanonicalBlock): string {
  if (block.type === 'paragraph') {
    return block.basis || '';
  }
  if (block.type === 'list' || block.type === 'steps') {
    return (block.items || []).join('; ');
  }
  if (block.type === 'subparagraph') {
    const parts: string[] = [];
    if (block.title) parts.push(`### ${block.number} ${block.title}`);
    for (const child of block.content || []) {
      parts.push(extractTextFromBlock(child));
    }
    return parts.join('\n\n');
  }
  return '';
}

function flattenBlocks(blocks: CanonicalBlock[]): CanonicalBlock[] {
  const flat: CanonicalBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'subparagraph') {
      for (const child of block.content || []) {
        flat.push(child);
      }
    } else {
      flat.push(block);
    }
  }
  return flat;
}

function countWords(text: string): number {
  const m = String(text ?? '').match(/[0-9A-Za-zÀ-ÖØ-öø-ÿ]+/g);
  return m ? m.length : 0;
}

function summarizeContent(text: string, maxLen = 100): string {
  const clean = text
    .replace(/<<BOLD_START>>/g, '')
    .replace(/<<BOLD_END>>/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '...';
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(argv: string[]): Record<string, string | boolean> {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : '';
  const sectionFilter = typeof args.section === 'string' ? String(args.section).trim() : '';
  const chapterFilter = typeof args.chapter === 'string' ? String(args.chapter).trim() : '';
  const modeRaw = typeof (args as any).mode === 'string' ? String((args as any).mode).trim().toLowerCase() : '';
  const mode: RewriteMode = modeRaw === 'indesign' ? 'indesign' : 'prince';
  const onlyIdsArg =
    (typeof (args as any)['only-ids'] === 'string' ? String((args as any)['only-ids']).trim() : '') ||
    (typeof (args as any).only_ids === 'string' ? String((args as any).only_ids).trim() : '') ||
    (typeof (args as any).onlyIds === 'string' ? String((args as any).onlyIds).trim() : '');
  const onlyIds = new Set(
    (onlyIdsArg ? onlyIdsArg.split(',') : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
  );
  const outPath = typeof args.out === 'string' ? path.resolve(args.out) : '';
  const model = typeof args.model === 'string' ? String(args.model).trim() : 'claude-sonnet-4-5-20250929';
  const provider: LlmProvider = String(args.provider || '').toLowerCase() === 'openai' ? 'openai' : 'anthropic';
  const errataArg = typeof (args as any).errata === 'string' ? String((args as any).errata).trim() : '';
  const maxRepairArg = typeof (args as any)['max-repair'] === 'string' ? String((args as any)['max-repair']).trim() : '';
  const maxRepair = Number.isFinite(Number(maxRepairArg)) ? Math.max(0, Math.min(5, Math.floor(Number(maxRepairArg)))) : 3;

  if (!inputPath || (!sectionFilter && !chapterFilter)) {
    console.error('Usage: npx ts-node scripts/llm-skeleton-rewrite.ts <canonical.json> --section 1.2 [--out output.json]');
    console.error('       npx ts-node scripts/llm-skeleton-rewrite.ts <canonical.json> --chapter 1 [--out output.json]');
    console.error('       Optional: --mode prince|indesign (default: prince) --only-ids <comma-separated paragraph_id list> --errata <path> --max-repair 3');
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const openaiKey = String(process.env.OPENAI_API_KEY ?? '').trim();
  const anthropicKey = String(process.env.ANTHROPIC_API_KEY ?? '').trim();

  if (provider === 'openai' && !openaiKey) {
    console.error('❌ Missing OPENAI_API_KEY');
    process.exit(1);
  }
  if (provider === 'anthropic' && !anthropicKey) {
    console.error('❌ Missing ANTHROPIC_API_KEY');
    process.exit(1);
  }

  const openai = provider === 'openai' ? new OpenAI({ apiKey: openaiKey, timeout: 10 * 60_000 }) : undefined;

  console.log(`📖 Loading canonical JSON: ${inputPath}`);
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  // Find target sections (either one section or all sections in a chapter)
  const targetSections: Array<{ section: CanonicalSection; chapterNumber: string }> = [];
  
  for (const chapter of data.chapters || []) {
    for (const section of chapter.sections || []) {
      if (sectionFilter && section.number === sectionFilter) {
        targetSections.push({ section, chapterNumber: chapter.number });
      } else if (chapterFilter && chapter.number === chapterFilter) {
        targetSections.push({ section, chapterNumber: chapter.number });
      }
    }
  }

  if (targetSections.length === 0) {
    console.error(`❌ No sections found for ${sectionFilter ? `section ${sectionFilter}` : `chapter ${chapterFilter}`}`);
    process.exit(1);
  }

  console.log(`\n🎯 Target: ${targetSections.length} section(s) in chapter ${targetSections[0].chapterNumber}`);
  for (const { section } of targetSections) {
    console.log(`   - ${section.number} "${section.title || ''}"`);
  }
  if (onlyIds.size) {
    console.log(`\n🎯 Limiting rewrite to ${onlyIds.size} paragraph_id(s) (--only-ids)`);
  }

  const errataPath = resolveErrataPathFromCwd(errataArg);
  const errataPack = loadErrataPack(errataPath);
  const errataCompiled = compileErrataRules(errataPack);
  if (errataCompiled.length) {
    console.log(`\n🧾 Errata pack loaded: ${errataPath || '(unknown path)'}`);
    console.log(`   Rules: ${errataCompiled.length}`);
    console.log(`   Repair budget per paragraph: ${maxRepair}`);
  } else {
    console.log(`\n🧾 Errata pack: none (or empty). No factual correction loop will run.`);
  }

  // Process all target sections
  const allMappings: MappedParagraph[] = [];
  const allSkeletons: Record<string, SkeletonOutput> = {};
  let totalOriginalWords = 0;
  let totalFreshWords = 0;

  for (const { section: targetSection, chapterNumber } of targetSections) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📝 Processing Section ${targetSection.number} "${targetSection.title || ''}"`);
    console.log(`${'='.repeat(60)}`);

    // Build section text and collect original blocks (optionally filtered by paragraph ids)
    const flatBlocksAll = flattenBlocks(targetSection.content);
    const flatBlocks = onlyIds.size ? flatBlocksAll.filter((b) => onlyIds.has(b.id)) : flatBlocksAll;
    if (onlyIds.size && flatBlocks.length === 0) {
      console.log(`   Skipping (no matching paragraph_id in this section)`);
      continue;
    }
    const sectionText = (onlyIds.size ? flatBlocks : flatBlocksAll).map((b) => extractTextFromBlock(b)).join('\n\n');
    const originalWordCount = countWords(sectionText);
    totalOriginalWords += originalWordCount;

    console.log(`   Paragraphs: ${flatBlocks.length}`);
    console.log(`   Word count: ${originalWordCount}`);

    // Prepare original paragraph metadata for mapping phase
    const originalParagraphs: OriginalParagraph[] = flatBlocks.map((block) => {
      const text = extractTextFromBlock(block);
      return {
        paragraph_id: block.id,
        style_name: block.styleHint || block.role || 'body',
        content_summary: summarizeContent(text, 120),
        ends_with_colon: text.trim().endsWith(':'),
        is_list: block.type === 'list' || block.type === 'steps',
        list_item_count: block.items?.length,
      };
    });

    // ==========================================================================
    // PHASE 1: Extract Skeleton
    // ==========================================================================
    console.log(`\n🦴 Phase 1: Extracting skeleton...`);
    const skeleton = await extractSkeleton({
      provider,
      model,
      openai,
      anthropicApiKey: anthropicKey,
      sectionText,
      sectionNumber: targetSection.number,
    });

    console.log(`   Terms extracted: ${skeleton.terms.length}`);
    console.log(`   Facts extracted: ${skeleton.facts.length}`);
    console.log(`   Examples extracted: ${skeleton.examples?.length || 0}`);
    console.log(`   Flow steps: ${skeleton.flow.length}`);

    allSkeletons[targetSection.number] = skeleton;

    // ==========================================================================
    // PHASE 2+3 COMBINED: Write fresh prose for each paragraph
    // ==========================================================================
    console.log(`\n✍️  Phase 2+3: Writing fresh prose per paragraph...`);
    const mappings = await writeParagraphByParagraph({
      provider,
      model,
      openai,
      anthropicApiKey: anthropicKey,
      skeleton,
      originalParagraphs,
      flatBlocks,
      sectionNumber: targetSection.number,
      sectionTitle: targetSection.title || '',
      errataCompiled,
      maxRepair,
      mode,
    });

    const sectionFreshWords = mappings.reduce((sum, m) => sum + countWords(m.rewritten), 0);
    totalFreshWords += sectionFreshWords;
    console.log(`   Section word count: ${sectionFreshWords} (original: ${originalWordCount})`);

    allMappings.push(...mappings);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 TOTALS: ${allMappings.length} paragraphs, ${totalFreshWords} words (original: ${totalOriginalWords})`);
  console.log(`${'='.repeat(60)}`);

  // Build freshProse for output (concatenate all paragraphs)
  const freshProse = allMappings.map(m => m.rewritten).join('\n\n');
  const mappings = allMappings;
  const skeleton = Object.values(allSkeletons)[0]; // Use first skeleton for output structure

  // ==========================================================================
  // Build Output JSON
  // ==========================================================================
  const chapterNum = targetSections[0].chapterNumber;
  const allFlatBlocks = targetSections.flatMap(({ section }) => flattenBlocks(section.content));

  // Validate mapping coverage
  if (!onlyIds.size) {
    const mappedIds = new Set(mappings.map((m) => m.paragraph_id));
    const allBlockIds = allFlatBlocks.map((b) => b.id);
    const missingIds = allBlockIds.filter((id) => !mappedIds.has(id));
    if (missingIds.length > 0) {
      console.warn(`   ⚠️  Missing mappings for ${missingIds.length} paragraph(s): ${missingIds.slice(0, 3).join(', ')}...`);
    }
  }
  
  const output: OutputJson = {
    book_title: data.meta?.title || 'Unknown',
    section: chapterFilter ? `chapter ${chapterFilter}` : targetSections[0].section.number,
    generated_at: new Date().toISOString(),
    method: 'skeleton-first',
    skeleton: Object.keys(allSkeletons).length === 1 ? skeleton : { combined: true, sections: allSkeletons } as any,
    fresh_prose: freshProse,
    paragraphs: mappings.map((m) => {
      const orig = allFlatBlocks.find((b) => b.id === m.paragraph_id);
      return {
        paragraph_id: m.paragraph_id,
        chapter: chapterNum,
        style_name: orig?.styleHint || orig?.role || 'body',
        original: extractTextFromBlock(orig || ({} as CanonicalBlock)),
        rewritten: m.rewritten,
      };
    }),
  };

  // Write output
  const outputName = chapterFilter 
    ? `skeleton_rewrite_chapter_${chapterFilter}.json`
    : `skeleton_rewrite_${targetSections[0].section.number.replace(/\./g, '_')}.json`;
  const finalOutPath = outPath || path.join(path.dirname(inputPath), outputName);
  fs.writeFileSync(finalOutPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n✅ Output written to: ${finalOutPath}`);

  // Print sample output for inspection
  console.log(`\n📝 Sample output (first 2 paragraphs):`);
  for (let i = 0; i < Math.min(2, output.paragraphs.length); i++) {
    const p = output.paragraphs[i];
    console.log(`\n--- Paragraph ${i + 1} (${p.paragraph_id}) ---`);
    console.log(`Style: ${p.style_name}`);
    console.log(`Original: ${p.original.slice(0, 150)}...`);
    console.log(`Rewritten: ${p.rewritten.slice(0, 150)}...`);
  }
}

main().catch((e) => {
  console.error('❌ Error:', e?.message || String(e));
  process.exit(1);
});

