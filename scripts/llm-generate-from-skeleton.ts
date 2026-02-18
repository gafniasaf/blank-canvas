#!/usr/bin/env npx tsx
/**
 * llm-generate-from-skeleton.ts
 * 
 * Generates rewritten content from skeleton using LLM.
 * Fast parallel processing with configurable concurrency.
 * 
 * Usage:
 *   npx tsx scripts/llm-generate-from-skeleton.ts \
 *     --skeleton skeleton.json \
 *     --out rewrites.json \
 *     --provider openai \
 *     --model gpt-4o-mini \
 *     [--section 1.1]
 */

import fs from 'fs';
import OpenAI from 'openai';
import { Skeleton, GenerationUnit } from '../src/lib/types/skeleton';

const MAX_CONCURRENT = 8;

const SYSTEM_PROMPT = `You are a Dutch educational content writer for MBO nursing textbooks.

STYLE RULES (N3 level):
- Simple, direct Dutch sentences
- Active voice, present tense
- No complex jargon unless it's a key term to learn
- Short paragraphs (2-3 sentences max)
- Student-friendly explanations

FORMATTING:
- Use <<BOLD_START>>term<<BOLD_END>> for key terms that students must learn
- Use <<MICRO_TITLE>>Title<<MICRO_TITLE_END>> for concept headings (green, bold, on own line)
- Keep terminology consistent: use "zorgvrager" (not cliënt), "zorgprofessional" (not verpleegkundige)

OUTPUT: Write ONLY the rewritten text. No meta-commentary.`;

interface RewriteResult {
  unit_id: string;
  rewritten_text: string;
}

async function generateRewrite(
  openai: OpenAI,
  model: string,
  unit: GenerationUnit,
  bookTitle: string
): Promise<RewriteResult> {
  const factsText = unit.content.facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
  
  let userPrompt: string;
  
  switch (unit.type) {
    case 'box_verdieping':
      userPrompt = `GENERATE a "Verdieping" (Deepening) box for "${bookTitle}".

SOURCE FACTS:
${factsText}

TASK: Select the MOST complex mechanism from these facts. Explain ONLY that mechanism in depth.
- Target: N4 students who want deeper understanding
- Write in simple N3 style (short sentences, active voice)
- Do NOT summarize the whole section
- Add technical detail not in the source (e.g., specific processes, biochemistry)
- 3-5 sentences max

Start with: <<MICRO_TITLE>>Verdieping<<MICRO_TITLE_END>>`;
      break;
      
    case 'box_praktijk':
      userPrompt = `GENERATE an "In de praktijk" (Practice) box for "${bookTitle}".

SOURCE FACTS:
${factsText}

TASK: Create a concrete nursing practice scenario related to this content.
- Show how this knowledge applies to patient care
- Include a realistic situation a nursing student might encounter
- Simple N3 Dutch, 3-5 sentences
- Be specific and practical

Start with: <<MICRO_TITLE>>In de praktijk<<MICRO_TITLE_END>>`;
      break;
      
    case 'composite_list':
      userPrompt = `REWRITE this list section for "${bookTitle}".

SOURCE (intro + items):
${factsText}

TASK: Rewrite as flowing prose OR keep as bullet list if appropriate.
- Preserve ALL key terms (<<BOLD_START>>...<<BOLD_END>>)
- Simple N3 Dutch
- If keeping as list, use bullet format: "• item"`;
      break;
      
    default: // prose
      userPrompt = `REWRITE this educational text for "${bookTitle}".

SOURCE FACTS:
${factsText}

TASK: Rewrite in clear, simple N3 Dutch.
- Preserve ALL key terms (<<BOLD_START>>...<<BOLD_END>>)
- Keep micro-headings if present (<<MICRO_TITLE>>...<<MICRO_TITLE_END>>)
- Short sentences, active voice
- Student-friendly`;
  }
  
  const response = await openai.chat.completions.create({
    model,
    max_tokens: 800,
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ]
  });
  
  return {
    unit_id: unit.id,
    rewritten_text: response.choices[0]?.message?.content?.trim() || ''
  };
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse args
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  
  const skeletonPath = getArg('skeleton');
  const outputPath = getArg('out');
  const model = getArg('model') || 'gpt-4o-mini';
  const sectionFilter = getArg('section');
  
  if (!skeletonPath || !outputPath) {
    console.error('Usage: npx tsx scripts/llm-generate-from-skeleton.ts --skeleton <file> --out <file> [--model gpt-4o-mini] [--section 1.1]');
    process.exit(1);
  }
  
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY not set');
    process.exit(1);
  }
  
  console.log(`📖 Reading skeleton from ${skeletonPath}...`);
  const skeleton: Skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
  const bookTitle = skeleton.metadata.title || 'MBO Textbook';
  
  // Collect units to process
  let allUnits: GenerationUnit[] = [];
  for (const section of skeleton.sections) {
    if (sectionFilter && section.id !== sectionFilter) {
      continue;
    }
    for (const sub of section.subsections) {
      allUnits.push(...sub.units);
    }
  }
  
  console.log(`🔄 Generating ${allUnits.length} rewrites with model ${model}...`);
  if (sectionFilter) {
    console.log(`   (filtered to section ${sectionFilter})`);
  }
  
  const openai = new OpenAI({ apiKey });
  const results: RewriteResult[] = [];
  
  // Process in parallel batches
  for (let i = 0; i < allUnits.length; i += MAX_CONCURRENT) {
    const batch = allUnits.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map(unit => generateRewrite(openai, model, unit, bookTitle))
    );
    results.push(...batchResults);
    process.stdout.write(`  Generated ${Math.min(i + MAX_CONCURRENT, allUnits.length)}/${allUnits.length}\r`);
  }
  
  console.log(`\n✅ Generated ${results.length} rewrites`);
  
  // Write output
  const output = {
    metadata: {
      skeleton_source: skeletonPath,
      model,
      generated_at: new Date().toISOString()
    },
    rewrites: results
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`✅ Written to ${outputPath}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});











