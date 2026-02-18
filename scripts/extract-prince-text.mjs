// Extract Prince PDF text with praktijk/verdieping for InDesign import
import * as fs from 'fs';
import * as path from 'path';

const JSON_PATH = path.resolve(import.meta.dirname, '../new_pipeline/output/af4_skeleton/full_20260104_163341/af4_skeleton_pass1_merged.with_openers.json');
const OUTPUT_TXT = path.resolve(import.meta.dirname, '../new_pipeline/output/af4_rewritten_text_for_indesign.txt');

function stripMarkup(text) {
  if (!text) return "";
  return text
    .replace(/<<BOLD_START>>/g, '')
    .replace(/<<BOLD_END>>/g, '')
    .replace(/<<MICRO_TITLE>>/g, '')
    .replace(/<<MICRO_TITLE_END>>/g, '')
    .replace(/\[\[BOX_SPLIT\]\]/g, '\n\n');
}

function buildFullText(json) {
  const output = [];
  let praktijkCount = 0;
  let verdiepingCount = 0;
  
  for (const chapter of json.chapters) {
    output.push("========================================");
    output.push(`HOOFDSTUK ${chapter.number}: ${chapter.title || ''}`);
    output.push("========================================\n");
    
    for (const section of chapter.sections || []) {
      output.push(`\n--- ${section.number} ${section.title || ''} ---\n`);
      
      for (const subpara of section.content || []) {
        if (subpara.type !== 'subparagraph') continue;
        
        output.push(`\n[${subpara.number}] ${subpara.title || ''}\n`);
        
        for (const para of subpara.content || []) {
          const basis = para.basis || '';
          if (basis) {
            output.push(stripMarkup(basis));
            output.push("");
          }
          
          const praktijk = para.praktijk || '';
          if (praktijk) {
            output.push("In de praktijk: " + stripMarkup(praktijk));
            output.push("");
            praktijkCount++;
          }
          
          const verdieping = para.verdieping || '';
          if (verdieping) {
            output.push("Verdieping: " + stripMarkup(verdieping));
            output.push("");
            verdiepingCount++;
          }
        }
      }
    }
    output.push("\n");
  }
  
  return { text: output.join("\n"), praktijkCount, verdiepingCount };
}

console.log("Reading JSON...");
const json = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
console.log(`  Loaded ${json.chapters.length} chapters`);

console.log("Building text...");
const { text, praktijkCount, verdiepingCount } = buildFullText(json);

console.log(`Writing to: ${OUTPUT_TXT}`);
fs.writeFileSync(OUTPUT_TXT, text, 'utf-8');

console.log("");
console.log("=== Export Complete ===");
console.log(`  Praktijk blocks: ${praktijkCount}`);
console.log(`  Verdieping blocks: ${verdiepingCount}`);
console.log(`  Output: ${OUTPUT_TXT}`);
