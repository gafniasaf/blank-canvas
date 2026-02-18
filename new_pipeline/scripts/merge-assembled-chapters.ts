/**
 * Merge assembled chapter JSONs into a single full-book JSON.
 * Usage: npx tsx scripts/merge-assembled-chapters.ts <output_dir> <out_json>
 */

import * as fs from 'fs';
import * as path from 'path';

interface CanonicalBook {
  meta?: {
    id?: string;
    title?: string;
    level?: string;
  };
  chapters: any[];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/merge-assembled-chapters.ts <output_dir> <out_json>');
    process.exit(1);
  }

  const outputDir = args[0]!;
  const outJson = args[1]!;

  // Find all assembled_ch*.json files
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('assembled_ch') && f.endsWith('.json'))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      return numA - numB;
    });

  if (files.length === 0) {
    console.error(`❌ No assembled_ch*.json files found in ${outputDir}`);
    process.exit(1);
  }

  console.log(`📚 Found ${files.length} assembled chapter files`);

  const merged: CanonicalBook = { chapters: [] };

  for (const f of files) {
    const filePath = path.join(outputDir, f);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CanonicalBook;
    
    // Use meta from first file
    if (!merged.meta && data.meta) {
      merged.meta = data.meta;
    }
    
    // Add chapters
    if (data.chapters && data.chapters.length > 0) {
      merged.chapters.push(...data.chapters);
    }
    
    console.log(`  ✓ ${f}`);
  }

  fs.writeFileSync(outJson, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`✅ Merged ${merged.chapters.length} chapters into: ${outJson}`);
}

main().catch(e => {
  console.error('❌ Error:', e);
  process.exit(1);
});

