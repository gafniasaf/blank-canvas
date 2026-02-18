/**
 * Pass 2: Add Verdieping boxes and Microheadings to existing rewrites
 * 
 * This runs per-chapter to avoid context length limits.
 * It reads the existing rewrites and skeleton, then:
 * 1. Plans microheadings for above-average blocks
 * 2. Selects verdieping candidates from complex content (≥65 words)
 * 3. Generates verdieping box content
 * 4. Merges into the existing rewrites
 */

import * as fs from 'fs';
import { loadEnv } from '../lib/load-env';
import { llmChatComplete, LlmChatMessage } from '../lib/llm';

loadEnv();

interface RewritesFile {
  metadata: {
    source_idml: string;
    title: string;
    chapter_id: string;
    version: string;
  };
  rewritten_units: Record<string, string>;
}

interface SkeletonUnit {
  id: string;
  type: string;
  content?: {
    facts?: string[];
    micro_heading?: string;
  };
  approx_words?: number;
  placement?: {
    section_id?: string;
    subsection_id?: string;
  };
}

interface SkeletonSubsection {
  id: string;
  units: SkeletonUnit[];
}

interface SkeletonSection {
  id: string;
  title: string;
  subsections: SkeletonSubsection[];
}

interface Skeleton {
  metadata: { title: string };
  sections: SkeletonSection[];
}

// --- Helpers ---

function stripInlineMarkers(text: string): string {
  return text
    .replace(/<<BOLD_START>>/g, '')
    .replace(/<<BOLD_END>>/g, '')
    .replace(/<<MICRO_TITLE>>/g, '')
    .replace(/<<MICRO_TITLE_END>>/g, '')
    .trim();
}

function countWords(text: string): number {
  return stripInlineMarkers(text).split(/\s+/).filter(w => w.length > 0).length;
}

async function llmChat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  provider: 'openai' | 'anthropic',
  model: string
): Promise<string> {
  const llmMessages: LlmChatMessage[] = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));
  return llmChatComplete({ 
    provider, 
    model, 
    messages: llmMessages,
    temperature: 0.3,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
}

function safeJsonParse<T>(txt: string): T | null {
  try {
    return JSON.parse(txt) as T;
  } catch {
    // Try to extract JSON from markdown code block
    const match = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// --- Main Planning Function (per-section) ---

async function planSectionMicroheadingsAndVerdieping(
  section: SkeletonSection,
  bookTitle: string,
  provider: 'openai' | 'anthropic',
  model: string
): Promise<{ microheadings: Record<string, string>; verdiepingIds: string[] }> {
  
  // Collect prose/composite_list units from this section
  const units: { id: string; words: number; preview: string }[] = [];
  
  for (const sub of section.subsections) {
    for (const unit of sub.units) {
      if (unit.type === 'prose' || unit.type === 'composite_list') {
        const facts = unit.content?.facts || [];
        const text = facts.join(' ');
        const words = countWords(text);
        if (words >= 30) { // Minimum to consider
          units.push({
            id: unit.id,
            words,
            preview: stripInlineMarkers(text).slice(0, 200) + '...',
          });
        }
      }
    }
  }

  if (units.length === 0) {
    return { microheadings: {}, verdiepingIds: [] };
  }

  // Calculate average words
  const avgWords = units.reduce((sum, u) => sum + u.words, 0) / units.length;
  
  // Microheading candidates: above average AND >= 55 words
  const microheadingCandidates = units.filter(u => u.words >= avgWords && u.words >= 55);
  
  // Verdieping candidates: >= 65 words (about 9 lines)
  const verdiepingCandidates = units.filter(u => u.words >= 65);

  const prompt = `You are planning microheadings and verdieping (deepening) blocks for a Dutch MBO healthcare textbook section.

BOOK: "${bookTitle}"
SECTION: ${section.id} - ${section.title}

## Units in this section (id | words | preview):
${units.map(u => `- ${u.id} | ${u.words} words | "${u.preview}"`).join('\n')}

## MICROHEADING CANDIDATES (above-average length, ≥55 words):
${microheadingCandidates.map(u => u.id).join(', ') || 'none'}

## VERDIEPING CANDIDATES (≥65 words, complex content):
${verdiepingCandidates.map(u => u.id).join(', ') || 'none'}

## YOUR TASK:

1. **Microheadings**: Select ~30-40% of the microheading candidates to receive a micro-title.
   - Micro-titles should be 2-4 word TOPIC LABELS (e.g., "De celmembraan", "Bloeddruk meten")
   - DO NOT use sentence fragments like "Een lysosoom is een"
   - DO NOT use generic words like "uitleg", "beschrijving", "functie"
   - Spread them evenly through the section

2. **Verdieping**: Select 1-2 units from verdieping candidates that contain the MOST COMPLEX content.
   - Look for: formulas, mechanisms, multi-step processes, technical depth
   - These will become highlighted "Verdieping" boxes
   - Spread them out (don't select adjacent units)
   - Skip if no genuinely complex content exists

Respond with JSON only:
{
  "microheadings": {
    "unit-id-1": "Topic Label",
    "unit-id-2": "Another Topic"
  },
  "verdieping_ids": ["unit-id-x", "unit-id-y"]
}`;

  try {
    const response = await llmChat(
      [
        { role: 'system', content: 'You are a Dutch textbook editor. Respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      provider,
      model
    );

    const parsed = safeJsonParse<{ microheadings: Record<string, string>; verdieping_ids: string[] }>(response);
    if (parsed) {
      return {
        microheadings: parsed.microheadings || {},
        verdiepingIds: parsed.verdieping_ids || [],
      };
    }
  } catch (err) {
    console.warn(`  ⚠️ Planning failed for section ${section.id}:`, (err as Error).message);
  }

  return { microheadings: {}, verdiepingIds: [] };
}

// Verdieping boxes use EXISTING content - no generation needed
// They are just marked to be rendered differently

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const skeletonPath = args[0] || 'output/skeleton_ch1.json';
  const rewritesPath = args[1] || 'output/rewrites_ch1.json';
  const outPath = args[2] || 'output/rewrites_ch1_pass2.json';
  const providerArg = args.find(a => a.startsWith('--provider='))?.split('=')[1] || 'anthropic';
  const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'claude-sonnet-4-5-20250929';

  const provider = providerArg as 'openai' | 'anthropic';
  const model = modelArg;

  console.log(`📚 Pass 2: Adding Verdieping & Microheadings`);
  console.log(`   Skeleton: ${skeletonPath}`);
  console.log(`   Rewrites: ${rewritesPath}`);
  console.log(`   Output: ${outPath}`);
  console.log(`   Provider: ${provider}, Model: ${model}`);

  // Load files
  const skeleton: Skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
  const rewrites: RewritesFile = JSON.parse(fs.readFileSync(rewritesPath, 'utf8'));

  const allMicroheadings: Record<string, string> = {};
  const allVerdiepingIds: string[] = [];

  // Process each section separately (to avoid context limits)
  for (const section of skeleton.sections) {
    console.log(`\n📖 Processing Section ${section.id}: ${section.title}`);
    
    const { microheadings, verdiepingIds } = await planSectionMicroheadingsAndVerdieping(
      section,
      skeleton.metadata.title,
      provider,
      model
    );

    console.log(`   → ${Object.keys(microheadings).length} microheadings, ${verdiepingIds.length} verdieping blocks`);

    Object.assign(allMicroheadings, microheadings);
    allVerdiepingIds.push(...verdiepingIds);
  }

  // Remove verdieping units from microheadings (verdieping boxes don't get microheadings)
  for (const unitId of allVerdiepingIds) {
    if (allMicroheadings[unitId]) {
      delete allMicroheadings[unitId];
    }
  }

  console.log(`\n✨ Total: ${Object.keys(allMicroheadings).length} microheadings, ${allVerdiepingIds.length} verdieping blocks`);

  // Apply microheadings to rewrites (only for non-verdieping units)
  for (const [unitId, heading] of Object.entries(allMicroheadings)) {
    if (rewrites.rewritten_units[unitId]) {
      const existingText = rewrites.rewritten_units[unitId];
      // Prepend micro-title marker
      rewrites.rewritten_units[unitId] = `<<MICRO_TITLE>>${heading}<<MICRO_TITLE_END>>\n\n${existingText}`;
    }
  }

  // Mark verdieping units (use EXISTING content, just mark for box rendering)
  console.log(`\n🔬 Marking Verdieping blocks...`);
  for (const unitId of allVerdiepingIds) {
    if (rewrites.rewritten_units[unitId]) {
      let existingText = rewrites.rewritten_units[unitId];
      // Strip any existing micro-title markers (verdieping boxes shouldn't have microheadings)
      existingText = existingText.replace(/<<MICRO_TITLE>>[\s\S]*?<<MICRO_TITLE_END>>\n*/g, '').trim();
      // Mark as verdieping box by prefixing with special marker (keeps existing content)
      rewrites.rewritten_units[unitId] = `<<VERDIEPING_BOX>>${existingText}<<VERDIEPING_BOX_END>>`;
      console.log(`   → Marked ${unitId.slice(0, 8)}... as Verdieping`);
    }
  }

  // Save updated rewrites
  fs.writeFileSync(outPath, JSON.stringify(rewrites, null, 2));
  console.log(`\n✅ Pass 2 complete! Saved to: ${outPath}`);
}

main().catch(console.error);

