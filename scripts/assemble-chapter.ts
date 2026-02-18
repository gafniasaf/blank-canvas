#!/usr/bin/env npx tsx
/**
 * assemble-chapter.ts
 * 
 * Assembles final canonical JSON by merging:
 * - Original canonical JSON (structure + non-rewritten content)
 * - Skeleton (unit mappings)
 * - Rewrites (LLM-generated text)
 * 
 * Usage:
 *   npx tsx scripts/assemble-chapter.ts <canonical.json> <skeleton.json> <rewrites.json> <output.json>
 */

import fs from 'fs';
import { Skeleton, GenerationUnit } from '../src/lib/types/skeleton';

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
  [key: string]: unknown;
}

interface RewritesFile {
  metadata: { skeleton_source: string; model: string; generated_at: string };
  rewrites: Array<{ unit_id: string; rewritten_text: string }>;
}

function buildRewriteMap(rewrites: RewritesFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rewrites.rewrites) {
    map.set(r.unit_id, r.rewritten_text);
  }
  return map;
}

function buildBlockToUnitMap(skeleton: Skeleton): Map<string, GenerationUnit> {
  const map = new Map<string, GenerationUnit>();
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      for (const unit of sub.units) {
        for (const mapping of unit.n4_mapping) {
          map.set(mapping.original_id, unit);
        }
      }
    }
  }
  return map;
}

function applyRewriteToBlock(
  block: CanonicalBlock,
  unit: GenerationUnit,
  rewriteText: string
): void {
  if (block.type === 'paragraph') {
    block.basis = rewriteText;
  } else if (block.type === 'list') {
    // Parse bullet list from rewrite if it contains bullets
    const lines = rewriteText.split('\n').filter(l => l.trim());
    const bullets = lines.filter(l => l.trim().startsWith('•') || l.trim().startsWith('-'));
    
    if (bullets.length > 0) {
      block.items = bullets.map(b => b.replace(/^[•\-]\s*/, '').trim());
    } else {
      // Convert to paragraph if no bullets
      block.type = 'paragraph';
      block.basis = rewriteText;
      delete block.items;
    }
  }
}

function collectBoxes(skeleton: Skeleton, rewriteMap: Map<string, string>): Map<string, CanonicalBlock[]> {
  // Maps host_block_id -> array of box blocks to insert after
  const boxMap = new Map<string, CanonicalBlock[]>();
  
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      for (const unit of sub.units) {
        if (!unit.type.startsWith('box_')) continue;
        
        const rewrite = rewriteMap.get(unit.id);
        if (!rewrite) continue;
        
        // Find anchor
        const hostBlockId = unit.placement.host_block_id || 
          (unit.n4_mapping[0]?.original_id);
        
        if (!hostBlockId) continue;
        
        const boxBlock: CanonicalBlock = {
          type: unit.type === 'box_praktijk' ? 'praktijk_box' : 'verdieping_box',
          id: unit.id,
          basis: rewrite,
          role: unit.type === 'box_praktijk' ? 'praktijk' : 'verdieping'
        };
        
        if (!boxMap.has(hostBlockId)) {
          boxMap.set(hostBlockId, []);
        }
        boxMap.get(hostBlockId)!.push(boxBlock);
      }
    }
  }
  
  return boxMap;
}

function processContent(
  content: CanonicalBlock[],
  blockToUnit: Map<string, GenerationUnit>,
  rewriteMap: Map<string, string>,
  boxMap: Map<string, CanonicalBlock[]>
): CanonicalBlock[] {
  const result: CanonicalBlock[] = [];
  
  for (const block of content) {
    // Recursively process subparagraphs
    if (block.type === 'subparagraph' && block.content) {
      const processed = {
        ...block,
        content: processContent(block.content, blockToUnit, rewriteMap, boxMap)
      };
      result.push(processed);
      continue;
    }
    
    // Check if this block has a rewrite
    const unit = blockToUnit.get(block.id);
    if (unit) {
      const rewrite = rewriteMap.get(unit.id);
      if (rewrite) {
        const newBlock = { ...block };
        applyRewriteToBlock(newBlock, unit, rewrite);
        result.push(newBlock);
      } else {
        result.push(block);
      }
    } else {
      result.push(block);
    }
    
    // Insert any boxes that anchor to this block
    const boxes = boxMap.get(block.id);
    if (boxes) {
      result.push(...boxes);
    }
  }
  
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const [canonicalPath, skeletonPath, rewritesPath, outputPath] = args;
  
  if (!canonicalPath || !skeletonPath || !rewritesPath || !outputPath) {
    console.error('Usage: npx tsx scripts/assemble-chapter.ts <canonical.json> <skeleton.json> <rewrites.json> <output.json>');
    process.exit(1);
  }
  
  console.log('📖 Loading files...');
  const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  const skeleton: Skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
  const rewrites: RewritesFile = JSON.parse(fs.readFileSync(rewritesPath, 'utf8'));
  
  console.log(`  Canonical: ${canonicalPath}`);
  console.log(`  Skeleton: ${skeletonPath}`);
  console.log(`  Rewrites: ${rewrites.rewrites.length} entries`);
  
  const rewriteMap = buildRewriteMap(rewrites);
  const blockToUnit = buildBlockToUnitMap(skeleton);
  const boxMap = collectBoxes(skeleton, rewriteMap);
  
  console.log(`  Boxes to insert: ${Array.from(boxMap.values()).flat().length}`);
  
  // Deep clone canonical
  const output = JSON.parse(JSON.stringify(canonical));
  
  // Process each chapter
  for (const chapter of output.chapters) {
    for (const section of chapter.sections) {
      section.content = processContent(
        section.content,
        blockToUnit,
        rewriteMap,
        boxMap
      );
    }
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`✅ Assembled chapter written to ${outputPath}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});











