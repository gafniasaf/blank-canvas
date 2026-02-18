import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import { Skeleton, GenerationUnit } from '../../src/lib/types/skeleton';
import { llmChatComplete, withRetries, type LlmProvider } from '../lib/llm';
import { loadEnv } from '../lib/load-env';

// Load env (repo-root/new_pipeline .env(.local), ENV_FILE, etc).
loadEnv();

const BOX_SPLIT_TOKEN = '[[BOX_SPLIT]]';
const PRAKTIJK_FORBIDDEN_GENERIC_PHRASES = [
  // Avoid the exact redundant patterns users reported.
  'je vraagt of de zorgvrager zich goed voelt',
  'je vraagt of de zorgvrager zich beter voelt',
  'je vraagt hoe de zorgvrager zich voelt',
];
const PRAKTIJK_BOILERPLATE_PATTERNS = [
  // Boilerplate we don't want repeated across a book; allow only when truly necessary.
  'noteer',
  'dossier',
  'bespreek',
  'bespreken met je team',
  'met je team',
];

// =============================================================================
// Prompts
// =============================================================================

const SYSTEM_PROMPT = `You are writing Dutch educational content for MBO N3 level students (age 16-20).

CRITICAL: Write like a REAL Dutch MBO N3 textbook.
1. SENTENCES: Short, direct. One fact per sentence.
2. VOICE: Use "je" (not "jouw"). Use "we" for introductions.
3. CONCISENESS: No filler. No "namelijk", "bijzondere", "belangrijke".
4. STANDALONE: The text must make sense on its own. If the input facts are fragments (e.g. starting with lowercase verbs), restructure them into complete sentences with proper context.
5. TERMINOLOGY (student-facing): use "zorgvrager" and "zorgprofessional". Never use: verpleegkundige, cliënt, client, patiënt, patient.
6. MARKERS (VERY IMPORTANT):
   - Allowed markers are ONLY:
     <<BOLD_START>>, <<BOLD_END>>, <<MICRO_TITLE>>, <<MICRO_TITLE_END>>
   - Do NOT output ANY other <<...>> markers. In particular, never output <<term>>.
   - Preserve any existing <<BOLD_START>>...<<BOLD_END>> spans from the facts exactly as-is.
   - Do NOT invent new bold spans.
7. MICRO-HEADINGS: Micro-headings are preplanned in the skeleton. Only use the provided start marker if instructed. Otherwise do not output any <<MICRO_TITLE>> markers.

Output ONLY the rewritten Dutch text.`;

function stripAllowedInlineMarkersForWordCount(text: string): string {
  return String(text || '')
    .replace(/<<BOLD_START>>/g, '')
    .replace(/<<BOLD_END>>/g, '')
    .replace(/<<MICRO_TITLE>>/g, '')
    .replace(/<<MICRO_TITLE_END>>/g, '')
    .replace(/\r/g, '\n')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text: string): number {
  const s = stripAllowedInlineMarkersForWordCount(text);
  if (!s) return 0;
  return s.split(/\s+/g).filter(Boolean).length;
}

function validateNoUnknownAngleMarkers(text: string) {
  const allowed = new Set(['BOLD_START', 'BOLD_END', 'MICRO_TITLE', 'MICRO_TITLE_END']);
  const re = /<<([^<>\s]+)>>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ''))) !== null) {
    const tok = String(m[1] || '').trim();
    if (!allowed.has(tok)) throw new Error(`LLM output contains forbidden marker <<${tok}>>`);
  }
}

function removeMicroTitles(text: string): string {
  // Remove the entire micro-title directive segment (title text + markers).
  return String(text || '').replace(/<<MICRO_TITLE>>[\s\S]*?<<MICRO_TITLE_END>>\s*/gu, '');
}

function normalizeSpaces(text: string): string {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitIntoSentences(text: string): string[] {
  const s = normalizeSpaces(text);
  if (!s) return [];
  // Conservative: split on sentence end punctuation.
  return s
    .split(/(?<=[.!?])\s+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeForDedupe(text: string): string {
  const s = String(text || '');
  // Remove soft hyphens (U+00AD)
  const noShy = s.replace(/\u00ad/g, '');
  // Remove common format chars (Cf) we see in IDML exports (word joiners, zero-width spaces)
  const noCf = Array.from(noShy)
    .filter((ch) => !['\u2060', '\ufeff', '\u200b', '\u200c', '\u200d'].includes(ch))
    .join('');
  return normalizeSpaces(noCf).toLowerCase();
}

function containsForbiddenPraktijkPhrase(text: string): boolean {
  const n = normalizeForDedupe(text);
  return PRAKTIJK_FORBIDDEN_GENERIC_PHRASES.some((p) => n.includes(p));
}

function firstSentence(text: string): string {
  const sents = splitIntoSentences(text);
  return sents[0] || normalizeSpaces(text);
}

function questionSentences(text: string): string[] {
  const sents = splitIntoSentences(text);
  const qs: string[] = [];
  for (const s of sents) {
    const n = normalizeForDedupe(s);
    if (n.startsWith('je vraagt')) qs.push(n);
  }
  return qs;
}

function safeJsonParse<T>(raw: string): T {
  const t = String(raw || '').trim();
  const txt = t.replace(/^```[^\n]*\n/, '').replace(/\n```[\s]*$/, '').trim();
  try {
    return JSON.parse(txt) as T;
  } catch {
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(txt.slice(start, end + 1)) as T;
    throw new Error(`Could not parse JSON from model output:\n${t.slice(0, 800)}`);
  }
}

type PraktijkEditorialInput = {
  book_title: string;
  section_id: string;
  section_title: string;
  boxes: Array<{
    unit_id: string;
    subsection_id: string;
    subsection_title: string;
    facts: string[];
    text: string;
  }>;
};

type PraktijkEditorialOutput = {
  rewritten: Record<string, string>;
};

async function llmEditorialPassPraktijk(opts: {
  input: PraktijkEditorialInput;
  provider: LlmProvider;
  model: string;
  openai?: OpenAI;
  anthropicApiKey?: string;
}): Promise<PraktijkEditorialOutput> {
  const system = `You are the editorial pass for "In de praktijk" boxes in a Dutch MBO N3 nursing textbook.

Goal: Reduce repetition across the set while keeping each box useful and realistic.

Hard requirements (apply to EVERY box):
- Keep "je" perspective.
- Always use "zorgvrager". You may use "in je werk als zorgprofessional" at most once per box. Never write "de zorgprofessional".
- Remove boilerplate admin endings (\"noteer...\", \"bespreek met je team\", \"in het dossier\") unless it is truly essential for the scenario.
- Avoid repeating opener templates across boxes. In particular, do NOT start most boxes with \"Je helpt een zorgvrager met ...\"; vary the opening action naturally (observe / begeleid / controleer / leg uit (patient-relevant) / meet / ondersteun / etc).
- Patient-facing explanations: ONLY explain what is relevant for the zorgvrager to understand. Avoid deep technical jargon unless it directly supports adherence/symptoms/recovery/self-care.
  If a concept is too technical, keep it as your own understanding (\"Je weet dat ...\") and translate it into a practical action instead of teaching the mechanism.
- Keep each box 4–7 sentences, single paragraph.
- Do NOT add labels like \"In de praktijk:\" (layout handles it).
- Allowed markers ONLY: <<BOLD_START>>, <<BOLD_END>>. Do NOT output any other <<...>> markers.
- Preserve any existing <<BOLD_START>>...<<BOLD_END>> spans exactly as-is; do not invent new bold spans.

Return STRICT JSON ONLY:
{ \"rewritten\": { \"unit_id\": \"text\", ... } }`;

  const user = `INPUT JSON:\n${JSON.stringify(opts.input, null, 2)}`;

  const raw = await withRetries(`praktijk-editorial-${opts.input.section_id}`, () =>
    llmChatComplete({
      provider: opts.provider,
      model: opts.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      openai: opts.openai,
      anthropicApiKey: opts.anthropicApiKey,
      maxTokens: 2000,
    })
  );

  const parsed = safeJsonParse<PraktijkEditorialOutput>(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.rewritten || typeof parsed.rewritten !== 'object') {
    throw new Error('Invalid editorial output (missing rewritten map).');
  }
  return parsed;
}

function splitTextBySentenceBudget(opts: {
  text: string;
  targetParts: number;
  minWordsPerPart: number;
  maxWordsPerPart: number;
}): string[] | null {
  const sentences = splitIntoSentences(opts.text);
  if (sentences.length === 0) return null;

  const parts: string[] = [];
  let cur: string[] = [];

  const flush = () => {
    const chunk = cur.join(' ').trim();
    if (chunk) parts.push(chunk);
    cur = [];
  };

  for (const sent of sentences) {
    const next = [...cur, sent].join(' ').trim();
    const nextWords = countWords(next);
    if (cur.length > 0 && nextWords > opts.maxWordsPerPart && parts.length < opts.targetParts - 1) {
      flush();
    }
    cur.push(sent);
  }
  flush();

  // Merge tiny trailing parts into previous part.
  for (let i = parts.length - 1; i > 0; i--) {
    if (countWords(parts[i]!) < opts.minWordsPerPart) {
      parts[i - 1] = `${parts[i - 1]} ${parts[i]}`.trim();
      parts.splice(i, 1);
    }
  }

  if (parts.length !== opts.targetParts) return null;
  if (parts.some((p) => countWords(p) < opts.minWordsPerPart)) return null;
  return parts;
}

function splitLongTextIntoParagraphsPreserve(opts: { text: string; maxWordsPerPara: number; minWordsPerPara: number; maxParas: number }): string {
  const raw = String(opts.text || '').trim();
  if (!raw) return raw;
  const words = countWords(raw);
  const targetParas = Math.min(opts.maxParas, Math.max(1, Math.ceil(words / opts.maxWordsPerPara)));
  if (targetParas <= 1) return raw;

  // Try a few descending targets; if we can't make valid chunks, keep original.
  for (let paras = targetParas; paras >= 2; paras--) {
    const parts = splitTextBySentenceBudget({
      text: raw,
      targetParts: paras,
      minWordsPerPart: opts.minWordsPerPara,
      maxWordsPerPart: Math.max(opts.maxWordsPerPara, Math.ceil(words / paras) + 20),
    });
    if (!parts) continue;
    return parts.join('\n\n');
  }
  return raw;
}

function splitLongBoxPreserve(opts: { text: string; maxWordsPerPart: number; minWordsPerPart: number; maxParts: number }): string {
  const raw = String(opts.text || '').trim();
  if (!raw) return raw;
  if (raw.includes(BOX_SPLIT_TOKEN)) return raw;

  const words = countWords(raw);
  const targetParts = Math.min(opts.maxParts, Math.max(1, Math.ceil(words / opts.maxWordsPerPart)));
  if (targetParts <= 1) return raw;
  if (words < opts.minWordsPerPart * 2) return raw; // would create tiny parts

  for (let partsN = targetParts; partsN >= 2; partsN--) {
    const parts = splitTextBySentenceBudget({
      text: raw,
      targetParts: partsN,
      minWordsPerPart: opts.minWordsPerPart,
      maxWordsPerPart: Math.max(opts.maxWordsPerPart, Math.ceil(words / partsN) + 15),
    });
    if (!parts) continue;
    const joined = parts.join(`\n\n${BOX_SPLIT_TOKEN}\n\n`);
    validateNoUnknownAngleMarkers(joined);
    return joined;
  }
  return raw;
}

async function generateUnitText(opts: {
  unit: GenerationUnit;
  ctx: {
    bookTitle: string;
    sectionId: string;
    sectionTitle: string;
    subsectionId: string;
    subsectionTitle: string;
  };
  provider: LlmProvider;
  model: string;
  openai?: OpenAI;
  anthropicApiKey?: string;
  /** Optional extra constraints appended to the prompt (used for anti-redundancy retries). */
  extraInstruction?: string;
}): Promise<string> {
  const { unit } = opts;
  const rawFacts = Array.isArray(unit.content?.facts) ? unit.content.facts : [];
  const isGeneratedPraktijk =
    unit.type === 'box_praktijk' && rawFacts.some((f) => String(f || '').trim() === 'GENERATE_PRAKTIJK');
  const factsForPrompt = isGeneratedPraktijk ? rawFacts.filter((f) => String(f || '').trim() !== 'GENERATE_PRAKTIJK' ) : rawFacts;
  const facts = factsForPrompt.map((f, i) => `${i + 1}. ${f}`).join('\n');

  let instruction = '';

  if (unit.type === 'composite_list') {
    instruction = `This is a composite list block (Intro + Items).
    Write this in the most natural N3 style.
    Option A: A running paragraph (if items are explanatory).
    Option B: A semicolon list (if items are short/parallel).

    Content Level: MBO N3 (Vocational).
    CRITICAL: SIMPLIFY complex theory into accessible explanations.
    Constraint: Do NOT split the intro from the content. It must be ONE coherent text block.

    IMPORTANT: Preserve any <<BOLD_START>>...<<BOLD_END>> spans exactly as they appear in the facts. Do NOT invent any new markers.`;
  } else if (unit.type === 'box_verdieping') {
    instruction = `This block is classified as **Verdieping** (Deepening) - more advanced detail.
    
    CRITICAL: The input facts may be LIST FRAGMENTS (starting with lowercase verbs). You MUST:
    1. First INTRODUCE what subject these facts are about (use the section context).
    2. Then explain each fact as a COMPLETE, STANDALONE sentence.
    
    BAD: "zorgen dat X deelt. geven signalen aan Y."
    GOOD: "[Subject] heeft verschillende functies. Het zorgt ervoor dat X deelt. Ook geeft het signalen aan Y."
    
    Task: Rewrite into clear N3 Dutch with proper context and complete sentences.
    Style: Short sentences. Active voice.
    DO NOT write meta-introductions like: "In deze sectie...", "In dit hoofdstuk...", "Hier leer je...".
    Start directly with the content (the concept/mechanism), as if it's a normal textbook paragraph.
    Do NOT add any labels like "Verdieping:" (layout handles it).`;
  } else if (unit.type === 'box_praktijk') {
    if (isGeneratedPraktijk) {
      instruction = `Generate a NEW **In de praktijk** box (nursing practice) for this subsection.
      Context:
      - Book: "${opts.ctx.bookTitle}"
      - Section: ${opts.ctx.sectionId} ${opts.ctx.sectionTitle}
      - Subsection: ${opts.ctx.subsectionId} ${opts.ctx.subsectionTitle}

      FIRST: Decide if a praktijk box is RELEVANT for this subsection topic.
      - Ask: "Is there a realistic nursing scenario where this topic matters?"
      - If NO sensible connection exists, respond with exactly: SKIP
      - If YES, write the praktijk box.

      Requirements (if not skipping):
      - Perspective: write from the reader perspective using "je".
      - Always refer to the person as "zorgvrager" (not: verpleegkundige, cliënt, patiënt).
      - Start with "Je" and a concrete nursing moment with a zorgvrager.
      - The scenario MUST be topically relevant to THIS subsection.
        - The reader should think: "Ah, this is why I need to understand [subsection topic]."
        - Do NOT write a generic scenario that could fit any chapter.
      - Do NOT explain mechanisms to the zorgvrager. Show how your knowledge informs practical care.
      - Add 2–3 concrete details (what you do/observe/ask/record).
      - Keep it short: ~4–7 sentences, single paragraph.
      - Do NOT add the label "In de praktijk:" (layout handles it).
      
      Respond with SKIP or the praktijk text (nothing else).`;
    } else {
      instruction = `This block is **In de praktijk** (Nursing Practice).
      Content: It contains nursing examples or clinical context.
      Task: Rewrite this text in clear, simple N3 Dutch.
      Style: Write from the reader perspective using "je". Be concrete and professional but accessible.
      Avoid generic openers like "In een zorginstelling..." and avoid "de zorgprofessional".
      Do NOT add the label "In de praktijk:" (layout handles it).`;
    }
  } else {
    instruction = `Write a concise paragraph using these facts.
    Target Level: MBO N3 (Vocational).
    CRITICAL: SIMPLIFY complex details into accessible explanations.
    Style: Short sentences. Active voice. "Je" form.
    Preserve any existing <<BOLD_START>>...<<BOLD_END>> spans from the facts exactly as-is. Do NOT invent any new markers.`;
  }

  if (opts.extraInstruction) {
    instruction += `\n\nEXTRA CONSTRAINTS:\n${String(opts.extraInstruction).trim()}`;
  }

  if (unit.content.micro_heading) {
    // Micro-titles are for body text only. Boxes must never start with a micro-title.
    if (!String(unit.type || '').startsWith('box_')) {
      instruction += `\nStart exactly with: <<MICRO_TITLE>>${unit.content.micro_heading}<<MICRO_TITLE_END>> (and do NOT add any other micro-title markers).`;
    } else {
      instruction += `\nDo NOT include any <<MICRO_TITLE>> markers in the output.`;
    }
  } else {
    instruction += `\nDo NOT include any <<MICRO_TITLE>> markers in the output.`;
  }

  const contextHeader = `CONTEXT:
  Book: ${opts.ctx.bookTitle}
  Section: ${opts.ctx.sectionId} ${opts.ctx.sectionTitle}
  Subsection: ${opts.ctx.subsectionId} ${opts.ctx.subsectionTitle}`;

  const userPrompt = `
  ${contextHeader}

  INPUT FACTS:
  ${facts}

  INSTRUCTION:
  ${instruction}

  Write now (Dutch):`;

  return withRetries(`unit-${unit.id}`, () =>
    llmChatComplete({
      provider: opts.provider,
      model: opts.model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      openai: opts.openai,
      anthropicApiKey: opts.anthropicApiKey,
      maxTokens: 1024,
    })
  );
}

// =============================================================================
// Main
// =============================================================================

interface OutputJson {
  metadata: any;
  rewritten_units: Record<string, string>; // unit_id -> text
}

async function main() {
  const args = process.argv.slice(2);
  // Parse args (simple version)
  const skeletonIdx = args.indexOf('--skeleton');
  const outIdx = args.indexOf('--out');
  const skeletonPath = skeletonIdx >= 0 ? args[skeletonIdx + 1] : '';
  const outPath = outIdx >= 0 ? args[outIdx + 1] : 'rewrites.json';
  const sectionFilterIdx = args.indexOf('--section');
  const sectionFilter = sectionFilterIdx >= 0 ? args[sectionFilterIdx + 1] : null;

  const providerIdx = args.indexOf('--provider');
  const modelIdx = args.indexOf('--model');
  const provider = (providerIdx >= 0 ? args[providerIdx + 1] : 'anthropic') as LlmProvider;
  const model = modelIdx >= 0 ? args[modelIdx + 1] : 'claude-sonnet-4-5-20250929';

  if (!skeletonPath) {
    console.error(
      'Usage: tsx new_pipeline/scripts/generate-from-skeleton.ts --skeleton <path> --out <path> [--provider anthropic|openai --model <model>] [--section 1.1]'
    );
    process.exit(1);
  }

  // Setup LLM clients
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openai = provider === 'openai' ? new OpenAI({ apiKey: openaiKey }) : undefined;

  // Load Skeleton
  const skeleton: Skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
  console.log(`📖 Loaded skeleton: ${skeletonPath}`);

  const results: Record<string, string> = {};
  const seenPraktijkOpeners = new Set<string>();
  const seenPraktijkQuestions = new Set<string>();

  // Collect generated praktijk boxes per section for a single editorial pass.
  const generatedPraktijkBySection: Record<
    string,
    Array<{ unit: GenerationUnit; ctx: { sectionId: string; sectionTitle: string; subsectionId: string; subsectionTitle: string } }>
  > = {};
  const sectionMeta: Record<string, { title: string }> = {};

  for (const section of skeleton.sections) {
    if (sectionFilter && section.id !== sectionFilter) continue;

    console.log(`\nProcessing Section ${section.id}: ${section.title}`);
    sectionMeta[String(section.id)] = { title: String(section.title || '') };
    for (const sub of section.subsections) {
      console.log(`  Subsection ${sub.id}: ${sub.units.length} units`);
      for (const unit of sub.units) {
        process.stdout.write(`    Unit ${unit.id} (${unit.type})... `);
        const text = await generateUnitText({
          unit,
          ctx: {
            bookTitle: String(skeleton.metadata?.title || '').trim() || 'Unknown Book',
            sectionId: String(section.id || ''),
            sectionTitle: String(section.title || ''),
            subsectionId: String(sub.id || ''),
            subsectionTitle: String(sub.title || ''),
          },
          provider,
          model,
          openai,
          anthropicApiKey: anthropicKey,
        });
        let out = text;
        
        // Handle SKIP response for generated praktijk boxes (LLM determined no relevant scenario exists)
        if (unit.type === 'box_praktijk' && out.trim().toUpperCase() === 'SKIP') {
          process.stdout.write(`Skipped (no relevant scenario)\n`);
          continue; // Don't add to results - this praktijk box won't be rendered
        }

        // Boxes: never allow micro-title markers in the box content.
        if (unit.type === 'box_praktijk' || unit.type === 'box_verdieping') {
          out = removeMicroTitles(out).trim();
        }

        // Praktijk anti-redundancy: if we see repeated template-y patterns, retry once with explicit constraints.
        const isGeneratedPraktijk =
          unit.type === 'box_praktijk' &&
          Array.isArray(unit.content?.facts) &&
          unit.content.facts.some((f) => String(f || '').trim() === 'GENERATE_PRAKTIJK');

        if (unit.type === 'box_praktijk' && isGeneratedPraktijk) {
          const opener = normalizeForDedupe(firstSentence(out));
          const qs = questionSentences(out);
          const violates =
            containsForbiddenPraktijkPhrase(out) ||
            (opener && seenPraktijkOpeners.has(opener)) ||
            qs.some((q) => seenPraktijkQuestions.has(q));

          if (violates) {
            const recentOpeners = Array.from(seenPraktijkOpeners).slice(-6);
            const recentQuestions = Array.from(seenPraktijkQuestions).slice(-6);
            const extra = [
              'Rewrite this Praktijk box with fresh wording (avoid redundancy).',
              `Forbidden phrases: ${PRAKTIJK_FORBIDDEN_GENERIC_PHRASES.map((p) => `"${p}"`).join(', ')}`,
              opener ? `Do NOT reuse this opener sentence (normalized): "${opener}"` : '',
              recentOpeners.length ? `Do NOT reuse these previous openers: ${recentOpeners.map((x) => `"${x}"`).join(', ')}` : '',
              recentQuestions.length ? `Do NOT reuse these previous "je vraagt ..." sentences: ${recentQuestions.map((x) => `"${x}"`).join(', ')}` : '',
              'Ask a SPECIFIC question tied to the facts (not a generic wellbeing check).',
              'Keep the same key concept from the facts. Keep 4–7 sentences. Single paragraph.',
            ]
              .filter(Boolean)
              .join('\n');

            const retry = await generateUnitText({
              unit,
              ctx: {
                bookTitle: String(skeleton.metadata?.title || '').trim() || 'Unknown Book',
                sectionId: String(section.id || ''),
                sectionTitle: String(section.title || ''),
                subsectionId: String(sub.id || ''),
                subsectionTitle: String(sub.title || ''),
              },
              provider,
              model,
              openai,
              anthropicApiKey: anthropicKey,
              extraInstruction: extra,
            });

            out = removeMicroTitles(retry).trim();
          }

          // Record patterns after final output (so next boxes can avoid them).
          const opener2 = normalizeForDedupe(firstSentence(out));
          if (opener2) seenPraktijkOpeners.add(opener2);
          for (const q of questionSentences(out)) seenPraktijkQuestions.add(q);

          // Queue this generated praktijk box for the editorial pass (LLM intelligence over the whole set).
          const secId = String(section.id || '');
          generatedPraktijkBySection[secId] = generatedPraktijkBySection[secId] || [];
          generatedPraktijkBySection[secId]!.push({
            unit,
            ctx: {
              sectionId: secId,
              sectionTitle: String(section.title || ''),
              subsectionId: String(sub.id || ''),
              subsectionTitle: String(sub.title || ''),
            },
          });
        }

        // Split long text blocks WITHOUT rewriting (layout-only split).
        // NOTE: For GENERATED praktijk boxes we postpone splitting until after the editorial pass,
        // so we edit the clean paragraph text and then split the final version.
        if (unit.type === 'box_praktijk' && !isGeneratedPraktijk) {
          out = splitLongBoxPreserve({ text: out, maxWordsPerPart: 85, minWordsPerPart: 55, maxParts: 3 });
        } else if (unit.type === 'box_verdieping') {
          out = splitLongBoxPreserve({ text: out, maxWordsPerPart: 100, minWordsPerPart: 60, maxParts: 4 });
        } else {
          // Regular body text: split very long blocks into multiple paragraphs (no content changes).
          out = splitLongTextIntoParagraphsPreserve({ text: out, maxWordsPerPara: 120, minWordsPerPara: 60, maxParas: 4 });
          validateNoUnknownAngleMarkers(out);
        }

        results[unit.id] = out;
        process.stdout.write(`Done (${text.split(' ').length} words)\n`);
      }
    }
  }

  // LLM editorial pass for generated praktijk boxes (per section): reduce repetition like
  // "Noteer ... bespreek met je team" and repetitive openers like "Je helpt een zorgvrager met ...".
  for (const [secId, items] of Object.entries(generatedPraktijkBySection)) {
    if (!items || items.length === 0) continue;
    const input: PraktijkEditorialInput = {
      book_title: String(skeleton.metadata?.title || '').trim() || 'Unknown Book',
      section_id: String(secId),
      section_title: String(sectionMeta[secId]?.title || ''),
      boxes: items.map(({ unit, ctx }) => ({
        unit_id: String(unit.id),
        subsection_id: ctx.subsectionId,
        subsection_title: ctx.subsectionTitle,
        facts: (unit.content?.facts || []).filter((f) => String(f || '').trim() !== 'GENERATE_PRAKTIJK').map((x) => String(x)),
        text: String(results[unit.id] || ''),
      })),
    };

    try {
      const edited = await llmEditorialPassPraktijk({
        input,
        provider,
        model,
        openai,
        anthropicApiKey: anthropicKey,
      });

      for (const box of input.boxes) {
        const revisedRaw = String(edited.rewritten?.[box.unit_id] || '').trim();
        if (!revisedRaw) continue;
        // Enforce marker safety and box rules
        const revised = removeMicroTitles(revisedRaw).trim();
        validateNoUnknownAngleMarkers(revised);
        // After editing, apply deterministic splitting for layout (no rewriting).
        const split = splitLongBoxPreserve({ text: revised, maxWordsPerPart: 85, minWordsPerPart: 55, maxParts: 3 });
        results[box.unit_id] = split;
      }
    } catch (e) {
      console.warn(`⚠️ Praktijk editorial pass failed for section ${secId}:`, e);
      // Fallback: still apply deterministic splitting to existing generated praktijk text.
      for (const { unit } of items) {
        const cur = String(results[unit.id] || '').trim();
        if (!cur) continue;
        results[unit.id] = splitLongBoxPreserve({ text: cur, maxWordsPerPart: 85, minWordsPerPart: 55, maxParts: 3 });
      }
    }
  }

  // Save Output
  const output: OutputJson = {
    metadata: skeleton.metadata,
    rewritten_units: results,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ Generated text saved to: ${outPath}`);
}

main().catch(console.error);


