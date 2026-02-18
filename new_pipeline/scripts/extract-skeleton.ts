import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { OpenAI } from 'openai';
import { Skeleton, GenerationUnit } from '../../src/lib/types/skeleton';
import { llmChatComplete, withRetries, type LlmProvider } from '../lib/llm';
import { loadEnv } from '../lib/load-env';

// Load env (repo-root/new_pipeline .env(.local), ENV_FILE, etc).
loadEnv();

// Types for the Input Canonical JSON
interface CanonicalJson {
  meta: {
    id: string;
    title: string;
    level: string;
    source_idml?: string; // Sometimes present
  };
  chapters: Array<{
    number: string;
    title: string;
    sections: Array<{
      number: string;
      title: string;
      content: CanonicalBlock[];
    }>;
  }>;
}

interface CanonicalBlock {
  type: 'paragraph' | 'list' | 'steps' | 'subparagraph';
  id: string;
  paragraphNumber?: number;
  number?: string;
  title?: string;
  basis?: string; // Text content
  items?: string[]; // List items
  content?: CanonicalBlock[]; // Children of subparagraph
  styleHint?: string;
  role?: string;
}

// =============================================================================
// Logic
// =============================================================================

function inferBlockType(block: CanonicalBlock): 'prose' | 'list' | 'box_praktijk' | 'box_verdieping' | 'subparagraph' {
  const style = (block.styleHint || block.role || '').toLowerCase();

  if (block.type === 'subparagraph') return 'subparagraph';

  // Keep existing explicit markers if present in source
  if (style.includes('praktijk') || style.includes('in de praktijk')) return 'box_praktijk';
  if (style.includes('verdieping')) return 'box_verdieping';

  if (block.type === 'list' || block.type === 'steps') return 'list';

  return 'prose';
}

function extractFacts(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function stripInlineMarkers(text: string): string {
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

function processContent(blocks: CanonicalBlock[], sectionId: string): GenerationUnit[] {
  const units: GenerationUnit[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const type = inferBlockType(block);

    if (type === 'subparagraph') {
      if (block.content) {
        units.push(...processContent(block.content, sectionId));
      }
      continue;
    }

    // Check for List Merging: Intro + List
    const text = block.basis || '';
    if (type === 'prose' && text.trim().endsWith(':')) {
      const nextBlock = blocks[i + 1];
      if (nextBlock && inferBlockType(nextBlock) === 'list') {
        const listItems = nextBlock.items || [];

        const unit: GenerationUnit = {
          id: crypto.randomUUID(),
          type: 'composite_list',
          n4_mapping: [
            { original_id: block.id, role: 'intro', subparagraph_index: i },
            { original_id: nextBlock.id, role: 'item', subparagraph_index: i + 1 },
          ],
          content: {
            facts: [text, ...listItems],
          },
          placement: { anchor_type: 'flow' },
        };
        units.push(unit);
        i++; // Skip the list block
        continue;
      }
    }

    let facts: string[] = [];
    if (type === 'list') {
      facts = block.items || [];
    } else {
      facts = extractFacts(block.basis || '');
    }

    const unit: GenerationUnit = {
      id: crypto.randomUUID(),
      type: type === 'list' ? 'composite_list' : type,
      n4_mapping: [
        {
          original_id: block.id,
          role: type === 'list' ? 'item' : 'body',
          subparagraph_index: i,
        },
      ],
      content: {
        facts: facts,
      },
      placement: { anchor_type: 'flow' },
    };

    units.push(unit);
  }

  return units;
}

function processSection(section: any, chapterId: string): any {
  const subSections = section.content
    .filter((b: any) => b.type === 'subparagraph')
    .map((sub: any) => ({
      id: sub.number || sub.id,
      title: sub.title || '',
      units: processContent(sub.content || [], section.number),
    }));

  const rootContent = section.content.filter((b: any) => b.type !== 'subparagraph');
  if (rootContent.length > 0) {
    subSections.unshift({
      id: `${section.number}.root`,
      title: 'Introduction',
      units: processContent(rootContent, section.number),
    });
  }

  return {
    id: section.number,
    title: section.title,
    subsections: subSections,
  };
}

type LayoutPlan = {
  micro_headings: Array<{ unit_id: string; title: string }>;
  verdieping_unit_ids: string[];
  notes?: string;
};

function safeJsonParse<T>(raw: string): T {
  const t = String(raw || '').trim();
  let txt = t
    .replace(/^```[^\n]*\n/, '')
    .replace(/\n```[\s]*$/, '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  
  // Try direct parse
  try {
    return JSON.parse(txt) as T;
  } catch (e1) {
    // Try extracting JSON object
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(txt.slice(start, end + 1)) as T;
      } catch (e2) {
        // Try to fix common JSON issues
        let fixed = txt.slice(start, end + 1);
        
        // Fix trailing commas in arrays and objects
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
        
        // Fix missing quotes around property names
        fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
        
        // Try truncated arrays - close them
        if ((fixed.match(/\[/g) || []).length > (fixed.match(/\]/g) || []).length) {
          fixed = fixed + ']'.repeat((fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length);
        }
        
        // Close unclosed objects
        if ((fixed.match(/\{/g) || []).length > (fixed.match(/\}/g) || []).length) {
          fixed = fixed + '}'.repeat((fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length);
        }
        
        try {
          return JSON.parse(fixed) as T;
        } catch (e3) {
          // Last resort: return minimal valid structure
          console.warn('⚠️ JSON repair failed, using empty plan');
          return { micro_headings: [], verdieping_unit_ids: [], notes: 'JSON parse failed' } as T;
        }
      }
    }
    // Return empty plan rather than throwing
    console.warn('⚠️ No valid JSON found in LLM response, using empty plan');
    return { micro_headings: [], verdieping_unit_ids: [], notes: 'No JSON found' } as T;
  }
}

async function planMicroHeadingsAndVerdieping(opts: {
  skeleton: Skeleton;
  bookTitle: string;
  openai?: OpenAI;
  anthropicApiKey?: string;
  model?: string;
}) {
  const { skeleton, bookTitle, openai, anthropicApiKey } = opts;

  // Collect ordered non-box units across the entire (possibly filtered) skeleton.
  const orderedUnits: Array<{
    unit: GenerationUnit;
    section_id: string;
    section_title: string;
    subsection_id: string;
    subsection_title: string;
    order: number;
    approx_words: number;
    preview: string;
  }> = [];

  let order = 0;
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      for (const unit of sub.units) {
        if (String(unit.type || '').startsWith('box_')) continue;
        const raw = stripInlineMarkers((unit.content?.facts || []).join(' '));
        const words = raw.split(/\s+/g).filter(Boolean).length;
        const preview = raw.slice(0, 260);
        orderedUnits.push({
          unit,
          section_id: section.id,
          section_title: section.title,
          subsection_id: sub.id,
          subsection_title: sub.title,
          order: order++,
          approx_words: words,
          preview,
        });
      }
    }
  }

  if (orderedUnits.length === 0) return;

  const avgWords =
    orderedUnits.reduce((sum, u) => sum + (Number.isFinite(u.approx_words) ? u.approx_words : 0), 0) /
    Math.max(1, orderedUnits.length);

  // User rule: microheadings for every block that is above the average block size.
  // Keep a small floor so we don't place microheadings on tiny blocks even if the average is low.
  const microCandidates = orderedUnits.filter((u) => u.approx_words > avgWords && u.approx_words >= 55);
  // Verdieping blocks need minimum ~65 words (~9 lines in single column, ~7 words/line)
  const verdiepingCandidates = orderedUnits.filter(
    (u) => (u.unit.type === 'prose' || u.unit.type === 'composite_list') && u.approx_words >= 65
  );

  if (microCandidates.length === 0 && verdiepingCandidates.length === 0) return;

  // More generous: we need multiple verdieping blocks in a typical chapter/section.
  // The LLM still decides which ones (relative complexity), but we steer the expected count.
  const verdiepingMin = Math.min(Math.max(2, Math.ceil(verdiepingCandidates.length * 0.08)), verdiepingCandidates.length);
  const verdiepingMax = Math.min(Math.max(verdiepingMin, Math.ceil(verdiepingCandidates.length * 0.14)), 6);

  const complexityScore = (txt: string, approxWords: number): number => {
    const s = String(txt || '');
    const digitCount = (s.match(/\d/g) || []).length;
    const symbolHits = /[=+→à]/u.test(s) ? 1 : 0;
    const parenCount = (s.match(/[()]/g) || []).length;
    const longTokenCount = s.split(/\s+/g).filter((w) => w.length >= 14).length;
    // Generic "density" signal: longer + symbols + digits tends to be more technical across subjects.
    return (
      Math.min(3, approxWords / 90) +
      symbolHits * 4 +
      Math.min(4, digitCount * 0.25) +
      Math.min(2, parenCount * 0.2) +
      Math.min(2, longTokenCount * 0.15)
    );
  };

  const input = {
    book_title: bookTitle,
    units_ordered: orderedUnits.length,
    avg_words_per_unit: Number.isFinite(avgWords) ? Math.round(avgWords) : null,
    micro_heading_candidates: microCandidates.map((u) => ({
      unit_id: u.unit.id,
      order: u.order,
      section_id: u.section_id,
      subsection_id: u.subsection_id,
      approx_words: u.approx_words,
      preview: u.preview,
    })),
    verdieping_candidates: verdiepingCandidates.map((u) => ({
      unit_id: u.unit.id,
      order: u.order,
      section_id: u.section_id,
      subsection_id: u.subsection_id,
      approx_words: u.approx_words,
      preview: u.preview,
    })),
    targets: {
      verdieping_range: [verdiepingMin, verdiepingMax],
    },
  };

  const system = `You are planning a skeleton for a Dutch MBO textbook rewrite pipeline.

You decide, BEFORE writing happens:
1) MICRO-HEADINGS: short topic labels above body text blocks (for scannability).
2) VERDIEPING selection: choose EXISTING units (do NOT inject new verdieping content). These units will be moved into Verdieping boxes.

MICRO-HEADING RULES:
- Dutch, 2–4 words, no colon, no punctuation, no quotes, no markers.
- Must be a TOPIC LABEL, not the start of a sentence.
  - GOOD: "Functies van [onderwerp]", "De [onderwerp]", "Kenmerken en eigenschappen"
  - BAD: "Een [onderwerp] is een" (sentence fragment - never start with "Een")
  - BAD: "[Onderwerp] uitleg" (generic word "uitleg")
  - BAD: Single technical term without context
- Do NOT use generic filler words: uitleg, beschrijving, informatie, overzicht, introductie, tekst.
- You MUST assign a micro-heading for EVERY unit_id in micro_heading_candidates.
- Do NOT assign micro-headings to units you select as Verdieping.

VERDIEPING RULES:
- Select units that are MORE complex relative to the rest (formulas, mechanisms, multi-step reasoning).
- Spread them out (not adjacent; avoid the very first units).
- NEVER label any unit as Praktijk here.

Return STRICT JSON ONLY:
{
  "micro_headings": [{"unit_id":"...","title":"..."}],
  "verdieping_unit_ids": ["..."],
  "notes": "..."
}`;

  const user = `INPUT JSON:\n${JSON.stringify(input, null, 2)}`;

  const provider = openai ? 'openai' : 'anthropic';
  const model = String(opts.model || '').trim() || (openai ? 'gpt-4o-mini' : 'claude-sonnet-4-5-20250929');
  const raw = await withRetries('plan-layout', () =>
    llmChatComplete({
      provider,
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      openai,
      anthropicApiKey,
      maxTokens: 4000,  // Increased to handle larger chapter structures
    })
  );

  const plan = safeJsonParse<LayoutPlan>(raw);

  const byId = new Map<string, GenerationUnit>();
  for (const u of orderedUnits) byId.set(u.unit.id, u.unit);

  const microCandidateIds = new Set(microCandidates.map((u) => u.unit.id));

  // Clear micro headings first (so the plan is the single source of truth).
  for (const u of orderedUnits) {
    if (u.unit.content) delete (u.unit.content as any).micro_heading;
  }

  for (const mh of Array.isArray(plan.micro_headings) ? plan.micro_headings : []) {
    const unit = byId.get(String(mh.unit_id || '').trim());
    const title = String(mh.title || '').trim();
    if (!unit || !title) continue;
    unit.content = unit.content || { facts: [] };
    unit.content.micro_heading = title;
  }

  // Convert selected existing units to box_verdieping (selection, not injection).
  const vIds = new Set(
    (Array.isArray(plan.verdieping_unit_ids) ? plan.verdieping_unit_ids : [])
      .map((x) => String(x).trim())
      .filter(Boolean)
  );

  const resolveOrder = (unitId: string) => orderedUnits.find((u) => u.unit.id === unitId)?.order ?? null;

  // Enforce max (trim if model overshoots).
  if (vIds.size > verdiepingMax) {
    const scored = Array.from(vIds)
      .map((id) => {
        const u = orderedUnits.find((x) => x.unit.id === id);
        const score = u ? complexityScore(u.preview, u.approx_words) : 0;
        return { id, score, order: u?.order ?? 99999 };
      })
      .sort((a, b) => b.score - a.score);
    vIds.clear();
    for (const it of scored) {
      if (vIds.size >= verdiepingMax) break;
      vIds.add(it.id);
    }
  }

  // Ensure we hit the requested minimum if the model under-selects (fallback: pick likely-complex units, spread out).
  if (vIds.size < verdiepingMin && verdiepingCandidates.length > 0) {
    const selectedOrders = new Set<number>(
      Array.from(vIds)
        .map((id) => resolveOrder(id))
        .filter((x): x is number => typeof x === 'number')
    );

    const scoredCandidates = verdiepingCandidates
      .map((u) => ({ id: u.unit.id, score: complexityScore(u.preview, u.approx_words), order: u.order }))
      .sort((a, b) => b.score - a.score);

    for (const cand of scoredCandidates) {
      if (vIds.size >= verdiepingMin) break;
      // Avoid the very first units and avoid adjacency to already selected verdieping.
      if (cand.order <= 2) continue;
      const tooClose = Array.from(selectedOrders).some((o) => Math.abs(o - cand.order) <= 1);
      if (tooClose) continue;
      vIds.add(cand.id);
      selectedOrders.add(cand.order);
    }
  }

  for (const id of vIds) {
    const unit = byId.get(id);
    if (!unit) continue;
    // Only allow selection from existing content units.
    if (unit.type !== 'prose' && unit.type !== 'composite_list') continue;
    unit.type = 'box_verdieping';
    // Boxes should not have micro-headings in their content.
    if (unit.content) delete (unit.content as any).micro_heading;
    const selfBlockId = unit.n4_mapping?.[0]?.original_id;
    if (selfBlockId) {
      unit.placement = {
        anchor_type: 'after_block',
        host_unit_id: unit.id,
        host_block_id: selfBlockId,
        anchor_id: unit.id,
      };
    }
  }

  // Enforce user rule: every above-average unit gets a micro-heading unless it became a Verdieping box.
  // Fallback: try to create a topic label if the LLM didn't provide one.
  // Rules: avoid sentence fragments, bolded terms, and generic words.
  const fallbackTitleFromFacts = (unit: GenerationUnit): string | null => {
    const joined = String((unit.content?.facts || []).join(' ') || '');
    const stripped = stripInlineMarkers(joined);
    
    // Try to find a bolded term and prefix it with "De" or "Het" to make a topic label
    const boldMatch = /<<BOLD_START>>([\s\S]*?)<<BOLD_END>>/u.exec(joined);
    if (boldMatch) {
      const term = String(boldMatch[1] || '').trim();
      // Only use if it's a noun-like term (not a verb or adjective)
      if (term.length >= 4 && term.length <= 30 && !/\s/.test(term)) {
        // Capitalize and add article
        const capitalized = term.charAt(0).toUpperCase() + term.slice(1);
        return `De ${capitalized.toLowerCase()}`;
      }
    }
    
    // Fallback: extract subject from first sentence (look for "De/Het X is/zijn")
    const subjectMatch = /^(De|Het)\s+([^\s]+(?:\s+[^\s]+)?)\s+(is|zijn|heeft|hebben)/iu.exec(stripped);
    if (subjectMatch) {
      const article = subjectMatch[1];
      const subject = subjectMatch[2];
      if (subject && subject.length >= 3 && subject.length <= 25) {
        return `${article} ${subject.toLowerCase()}`;
      }
    }
    
    return null; // No good fallback found - LLM should have provided one
  };

  for (const id of microCandidateIds) {
    if (vIds.has(id)) continue; // now a box
    const unit = byId.get(id);
    if (!unit) continue;
    if (!unit.content) unit.content = { facts: [] };
    if (unit.content.micro_heading) continue;
    const fallback = fallbackTitleFromFacts(unit);
    if (fallback) unit.content.micro_heading = fallback;
  }

  if (plan.notes) console.log(`🧠 Layout plan notes: ${String(plan.notes).slice(0, 250)}`);
}

function applyExplicitBoxAnchors(skeleton: Skeleton) {
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      let lastHost: GenerationUnit | null = null;
      for (const unit of sub.units) {
        const isBox = String(unit.type || '').startsWith('box_');
        if (!isBox) {
          lastHost = unit;
          continue;
        }
        // If the box already has an explicit anchor, do not override it.
        const hasExplicit = Boolean((unit as any)?.placement?.host_block_id);
        if (hasExplicit) continue;
        if (!lastHost) continue;
        const hostBlockId = lastHost.n4_mapping?.[0]?.original_id;
        if (!hostBlockId) continue;

        unit.placement = {
          ...(unit.placement || { anchor_type: 'after_block' }),
          anchor_type: 'after_block',
          host_unit_id: lastHost.id,
          host_block_id: hostBlockId,
          // Back-compat convenience
          anchor_id: lastHost.id,
        };
      }
    }
  }
}

function injectPraktijkBoxes(skeleton: Skeleton) {
  let injected = 0;
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      const alreadyHasPraktijk = sub.units.some((u) => u.type === 'box_praktijk');
      if (alreadyHasPraktijk) continue;

      const hasCoreContent = sub.units.some((u) => u.type === 'prose' || u.type === 'composite_list');
      if (!hasCoreContent) continue;

      // Anchor after the last prose/composite_list unit in this subsection.
      let anchorIdx = -1;
      for (let i = sub.units.length - 1; i >= 0; i--) {
        const u = sub.units[i]!;
        if (u.type === 'prose' || u.type === 'composite_list') {
          anchorIdx = i;
          break;
        }
      }
      if (anchorIdx < 0) continue;

      const anchorUnit = sub.units[anchorIdx]!;
      const hostBlockId = anchorUnit.n4_mapping?.[0]?.original_id;
      if (!hostBlockId) continue;

      const contextFacts = Array.isArray(anchorUnit.content?.facts) ? anchorUnit.content.facts.slice(0, 12) : [];
      const unit: GenerationUnit = {
        id: crypto.randomUUID(),
        type: 'box_praktijk',
        n4_mapping: [],
        content: {
          facts: ['GENERATE_PRAKTIJK', ...contextFacts],
        },
        placement: {
          anchor_type: 'after_block',
          host_unit_id: anchorUnit.id,
          host_block_id: hostBlockId,
          anchor_id: anchorUnit.id, // back-compat
        },
      };

      sub.units.splice(anchorIdx + 1, 0, unit);
      injected++;
    }
  }
  if (injected > 0) console.log(`🧩 Injected ${injected} praktijk box unit(s) into skeleton`);
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  const outputPath = args[1] || 'skeleton.json';
  const plan = !args.includes('--no-classify');
  const sectionFilterIdx = args.indexOf('--section');
  const sectionFilter = sectionFilterIdx >= 0 ? args[sectionFilterIdx + 1] : null;
  const chapterFilterIdx = args.indexOf('--chapter');
  const chapterFilter = chapterFilterIdx >= 0 ? args[chapterFilterIdx + 1] : null;
  const providerIdx = args.indexOf('--provider');
  const modelIdx = args.indexOf('--model');
  const providerArg = providerIdx >= 0 ? String(args[providerIdx + 1] || '').trim().toLowerCase() : '';
  const modelArg = modelIdx >= 0 ? String(args[modelIdx + 1] || '').trim() : '';
  const provider: LlmProvider | null =
    providerArg === 'openai' ? 'openai' : providerArg === 'anthropic' ? 'anthropic' : null;
  const model = modelArg || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-5-20250929');

  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error(
      'Usage: tsx new_pipeline/scripts/extract-skeleton.ts <input-canonical.json> [output-skeleton.json] [--chapter 1] [--section 1.1] [--provider anthropic|openai --model <model>] [--no-classify]'
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const data = JSON.parse(raw) as CanonicalJson;
  const bookTitle = data.meta.title || 'Unknown Book';

  const skeleton: Skeleton = {
    metadata: {
      source_idml: data.meta.source_idml || 'unknown',
      title: bookTitle,
      chapter_id: chapterFilter || data.chapters[0]?.number || 'unknown',
      version: '1.0',
    },
    sections: [],
  };

  for (const chapter of data.chapters) {
    // Skip chapters not matching the filter
    if (chapterFilter && String(chapter.number) !== String(chapterFilter)) continue;
    
    for (const section of chapter.sections) {
      if (sectionFilter && String(section.number) !== String(sectionFilter)) continue;
      skeleton.sections.push(processSection(section, chapter.number));
    }
  }

  if (plan) {
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if ((provider === 'openai' || (!provider && openaiKey)) && openaiKey) {
      const openai = new OpenAI({ apiKey: openaiKey });
      try {
        await planMicroHeadingsAndVerdieping({ skeleton, bookTitle, openai, model });
      } catch (err: unknown) {
        // Gracefully handle context length exceeded or other LLM errors
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('context_length_exceeded')) {
          console.warn('⚠️ LLM context length exceeded during planning. Using fallback logic for micro-headings/verdieping.');
        } else {
          console.error('⚠️ LLM planning failed:', errMsg);
        }
        // Continue without LLM planning - fallback logic will still apply microheadings
      }
    } else if ((provider === 'anthropic' || (!provider && anthropicKey)) && anthropicKey) {
      // Fall back to Anthropic if no OpenAI key
      try {
        await planMicroHeadingsAndVerdieping({ skeleton, bookTitle, anthropicApiKey: anthropicKey, model });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('⚠️ Anthropic planning failed:', errMsg);
      }
    } else {
      console.warn('⚠️ No OPENAI_API_KEY or ANTHROPIC_API_KEY found. Skipping micro-heading + verdieping planning.');
    }
  }

  // Add NEW (LLM-generated) praktijk boxes into the skeleton. Content is generated later.
  injectPraktijkBoxes(skeleton);

  // Ensure box units carry explicit anchors so assembly does not depend on ordering.
  applyExplicitBoxAnchors(skeleton);

  fs.writeFileSync(outputPath, JSON.stringify(skeleton, null, 2));
  console.log(`✅ Extracted skeleton to ${outputPath}`);
}

main().catch(console.error);


