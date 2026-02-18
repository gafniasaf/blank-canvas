#!/usr/bin/env npx tsx
/**
 * extract-skeleton.ts
 * 
 * Extracts a Skeleton from canonical JSON and optionally classifies prose units
 * as basis/praktijk/verdieping using LLM.
 * 
 * Usage:
 *   npx tsx scripts/extract-skeleton.ts <canonical.json> <skeleton.json> [--classify] [--section 1.1]
 */

import fs from 'fs';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { Skeleton, GenerationUnit, UnitType } from '../src/lib/types/skeleton';

// Fast parallel processing
const MAX_CONCURRENT_LLM_CALLS = 8;

interface CanonicalBlock {
  type: string;
  id: string;
  basis?: string;
  items?: string[];
  number?: string;
  title?: string;
  content?: CanonicalBlock[];
  role?: string;
  level?: number;
}

interface CanonicalSection {
  number: string;
  title: string;
  content: CanonicalBlock[];
}

interface CanonicalChapter {
  number: string;
  title: string;
  sections: CanonicalSection[];
}

interface CanonicalJSON {
  meta: { id: string; title: string; level: string };
  chapters: CanonicalChapter[];
}

function extractFacts(block: CanonicalBlock): string[] {
  if (block.type === 'paragraph' && block.basis) {
    return [block.basis];
  }
  if (block.type === 'list' && block.items) {
    return block.items;
  }
  return [];
}

function detectMicroHeading(text: string): string | undefined {
  // Check for bold-start terms at beginning (micro-headings)
  const match = text.match(/^<<BOLD_START>>([^<]+)<<BOLD_END>>:?\s*/);
  if (match) {
    return match[1].trim();
  }
  return undefined;
}

function blockToUnit(
  block: CanonicalBlock,
  subIndex: number,
  prevBlock?: CanonicalBlock
): GenerationUnit | null {
  const facts = extractFacts(block);
  if (facts.length === 0) return null;

  // Determine type
  let unitType: UnitType = 'prose';
  if (block.type === 'list') {
    unitType = 'composite_list';
  }

  // Check for micro-heading
  const microHeading = facts[0] ? detectMicroHeading(facts[0]) : undefined;

  return {
    id: randomUUID(),
    type: unitType,
    n4_mapping: [{
      original_id: block.id,
      role: block.type === 'list' ? 'item' : 'body',
      subparagraph_index: subIndex
    }],
    content: {
      facts,
      micro_heading: microHeading
    },
    placement: {
      anchor_type: 'flow'
    }
  };
}

function extractUnitsFromSubparagraph(subpara: CanonicalBlock): GenerationUnit[] {
  const units: GenerationUnit[] = [];
  const content = subpara.content || [];
  
  let pendingIntro: CanonicalBlock | null = null;
  
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    const nextBlock = content[i + 1];
    
    // Check if this is a list-intro paragraph (ends with ':' and followed by list)
    if (block.type === 'paragraph' && block.basis?.trim().endsWith(':') && nextBlock?.type === 'list') {
      pendingIntro = block;
      continue;
    }
    
    // If we have a pending intro and this is a list, merge them
    if (pendingIntro && block.type === 'list') {
      const introFacts = extractFacts(pendingIntro);
      const listFacts = extractFacts(block);
      
      units.push({
        id: randomUUID(),
        type: 'composite_list',
        n4_mapping: [
          { original_id: pendingIntro.id, role: 'intro', subparagraph_index: i - 1 },
          { original_id: block.id, role: 'item', subparagraph_index: i }
        ],
        content: {
          facts: [...introFacts, ...listFacts]
        },
        placement: { anchor_type: 'flow' }
      });
      
      pendingIntro = null;
      continue;
    }
    
    // Regular block
    const unit = blockToUnit(block, i);
    if (unit) {
      units.push(unit);
    }
    pendingIntro = null;
  }
  
  return units;
}

async function classifyUnit(
  openai: OpenAI,
  unit: GenerationUnit,
  bookTitle: string
): Promise<UnitType> {
  const factText = unit.content.facts.join(' ').substring(0, 500);
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 20,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `You classify educational content from "${bookTitle}" into exactly one category. Reply with ONLY the category name.

Categories:
- basis: Standard educational content explaining concepts
- verdieping: Complex technical/scientific depth (mechanisms, biochemistry, advanced details)
- praktijk: Nursing/healthcare practice applications, patient care examples

Reply with exactly one word: basis, verdieping, or praktijk`
      },
      {
        role: 'user',
        content: factText
      }
    ]
  });
  
  const result = response.choices[0]?.message?.content?.trim().toLowerCase() || 'basis';
  
  if (result === 'verdieping') return 'box_verdieping';
  if (result === 'praktijk') return 'box_praktijk';
  return 'prose';
}

async function classifyUnitsParallel(
  units: GenerationUnit[],
  bookTitle: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('⚠️  No OPENAI_API_KEY, skipping classification');
    return;
  }
  
  const openai = new OpenAI({ apiKey });
  const proseUnits = units.filter(u => u.type === 'prose');
  
  console.log(`🔄 Classifying ${proseUnits.length} prose units in parallel (max ${MAX_CONCURRENT_LLM_CALLS} concurrent)...`);
  
  // Process in batches for controlled parallelism
  for (let i = 0; i < proseUnits.length; i += MAX_CONCURRENT_LLM_CALLS) {
    const batch = proseUnits.slice(i, i + MAX_CONCURRENT_LLM_CALLS);
    const promises = batch.map(async (unit) => {
      const newType = await classifyUnit(openai, unit, bookTitle);
      unit.type = newType;
    });
    await Promise.all(promises);
    process.stdout.write(`  Classified ${Math.min(i + MAX_CONCURRENT_LLM_CALLS, proseUnits.length)}/${proseUnits.length}\r`);
  }
  
  console.log(`\n✅ Classification complete`);
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  const outputPath = args[1];
  const doClassify = args.includes('--classify');
  const sectionFilter = args.includes('--section') ? args[args.indexOf('--section') + 1] : null;
  
  if (!inputPath || !outputPath) {
    console.error('Usage: npx tsx scripts/extract-skeleton.ts <canonical.json> <skeleton.json> [--classify] [--section 1.1]');
    process.exit(1);
  }
  
  console.log(`📖 Reading ${inputPath}...`);
  const raw = fs.readFileSync(inputPath, 'utf8');
  const canonical: CanonicalJSON = JSON.parse(raw);
  
  const chapter = canonical.chapters[0];
  if (!chapter) {
    console.error('No chapter found in canonical JSON');
    process.exit(1);
  }
  
  const skeleton: Skeleton = {
    metadata: {
      source_idml: inputPath,
      title: canonical.meta.title,
      chapter_id: chapter.number,
      version: '1.0'
    },
    sections: []
  };
  
  for (const section of chapter.sections) {
    // Apply section filter if specified
    if (sectionFilter && section.number !== sectionFilter) {
      continue;
    }
    
    const skeletonSection = {
      id: section.number,
      title: section.title,
      subsections: [] as Array<{ id: string; title: string; units: GenerationUnit[] }>
    };
    
    for (const block of section.content) {
      if (block.type === 'subparagraph' && block.number && block.title) {
        const units = extractUnitsFromSubparagraph(block);
        skeletonSection.subsections.push({
          id: block.number,
          title: block.title,
          units
        });
      }
    }
    
    skeleton.sections.push(skeletonSection);
  }
  
  // Count units
  const allUnits = skeleton.sections.flatMap(s => s.subsections.flatMap(sub => sub.units));
  console.log(`📊 Extracted ${allUnits.length} units from ${skeleton.sections.length} section(s)`);
  
  // Optional LLM classification
  if (doClassify) {
    await classifyUnitsParallel(allUnits, canonical.meta.title);
  }
  
  // Write output
  fs.writeFileSync(outputPath, JSON.stringify(skeleton, null, 2));
  console.log(`✅ Skeleton written to ${outputPath}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});











