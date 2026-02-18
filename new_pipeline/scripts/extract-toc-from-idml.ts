#!/usr/bin/env npx tsx
/**
 * Extract TOC data from IDML files
 * IDML is a ZIP containing XML files with paragraph styles
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { XMLParser } from 'fast-xml-parser';

const IDML_MAP: Record<string, string> = {
  'communicatie': '/Users/asafgafni/Desktop/InDesign/TestRun/_source_exports/MBO_COMMUNICATIE_9789083251387_03_2024__FROM_DOWNLOADS.idml',
  'wetgeving': '/Users/asafgafni/Desktop/InDesign/TestRun/_source_exports/MBO_WETGEVING_9789083412061_03_2024__FROM_DOWNLOADS.idml',
  'persoonlijke_verzorging': '/Users/asafgafni/Desktop/InDesign/TestRun/_source_exports/MBO_PERSOONLIJKE_VERZORGING_9789083412023_03_2024__FROM_DOWNLOADS.idml',
  'klinisch_redeneren': '/Users/asafgafni/Desktop/InDesign/TestRun/_source_exports/MBO_PRAKTIJKGESTUURD_KLINISCH_REDENEREN_9789083412030_03_2024__FROM_DOWNLOADS.idml',
  'methodisch_werken': '/Users/asafgafni/Desktop/InDesign/TestRun/_source_exports/MBO_METHODISCH_WERKEN_9789083251394_03_2024__FROM_DOWNLOADS.idml',
  'pathologie': '/Users/asafgafni/Desktop/InDesign/TestRun/_source_exports/MBO_PATHOLOGIE_N4_9789083412016_03_2024__FROM_DOWNLOADS.idml',
  'af4': '/Users/asafgafni/Desktop/InDesign/TestRun/_source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml',
};

// Paragraph style patterns that indicate headings
const CHAPTER_PATTERNS = [
  /hoofdstuk/i, /chapter/i, /^h1$/i, /titel.*hoofdstuk/i, /hs.*titel/i,
  /kop.*1/i, /heading.*1/i
];

const SECTION_PATTERNS = [
  /paragraaf/i, /section/i, /^h2$/i, /titel.*paragraaf/i, /par.*titel/i,
  /kop.*2/i, /heading.*2/i
];

interface TocItem {
  level: number;
  num: string;
  label: string;
  page: string;
  style?: string;
}

interface TocData {
  bookId: string;
  items: TocItem[];
}

async function extractTocFromIdml(bookId: string): Promise<TocData> {
  const idmlPath = IDML_MAP[bookId];
  if (!idmlPath || !fs.existsSync(idmlPath)) {
    throw new Error(`IDML not found for ${bookId}: ${idmlPath}`);
  }

  // Create temp dir and extract IDML
  const tmpDir = `/tmp/idml_extract_${bookId}_${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  
  execSync(`unzip -q "${idmlPath}" -d "${tmpDir}"`);
  
  // Parse Styles.xml to get paragraph style names
  const stylesPath = path.join(tmpDir, 'Resources', 'Styles.xml');
  const stylesXml = fs.readFileSync(stylesPath, 'utf-8');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const styles = parser.parse(stylesXml);
  
  // Build style ID -> name map
  const styleMap: Record<string, string> = {};
  const pStyles = styles?.idPkg?.RootParagraphStyleGroup?.ParagraphStyle || [];
  const allPStyles = Array.isArray(pStyles) ? pStyles : [pStyles];
  
  function collectStyles(styleList: any[], prefix = '') {
    for (const s of styleList) {
      if (s && s['@_Self'] && s['@_Name']) {
        styleMap[s['@_Self']] = prefix + s['@_Name'];
      }
      // Check for nested style groups
      if (s?.ParagraphStyleGroup) {
        const groups = Array.isArray(s.ParagraphStyleGroup) ? s.ParagraphStyleGroup : [s.ParagraphStyleGroup];
        for (const g of groups) {
          const groupName = g['@_Name'] || '';
          const nested = g?.ParagraphStyle || [];
          collectStyles(Array.isArray(nested) ? nested : [nested], groupName + '/');
        }
      }
    }
  }
  collectStyles(allPStyles);
  
  // Read all Story files
  const storiesDir = path.join(tmpDir, 'Stories');
  const storyFiles = fs.readdirSync(storiesDir).filter(f => f.endsWith('.xml'));
  
  const items: TocItem[] = [];
  
  for (const storyFile of storyFiles) {
    const storyPath = path.join(storiesDir, storyFile);
    const storyXml = fs.readFileSync(storyPath, 'utf-8');
    const story = parser.parse(storyXml);
    
    // Find paragraphs
    const paragraphs = findParagraphs(story);
    
    for (const para of paragraphs) {
      const styleRef = para['@_AppliedParagraphStyle'] || '';
      const styleName = styleMap[styleRef] || styleRef;
      
      // Extract text content
      const text = extractText(para).trim();
      if (!text) continue;
      
      // Check if this is a chapter or section heading
      let level = 0;
      for (const pattern of CHAPTER_PATTERNS) {
        if (pattern.test(styleName)) {
          level = 1;
          break;
        }
      }
      if (level === 0) {
        for (const pattern of SECTION_PATTERNS) {
          if (pattern.test(styleName)) {
            level = 2;
            break;
          }
        }
      }
      
      if (level > 0) {
        // Parse number and label from text
        const match = text.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
        const num = match ? match[1] : '';
        const label = match ? match[2] : text;
        
        items.push({
          level,
          num,
          label: label.substring(0, 100), // Truncate long labels
          page: '', // Page numbers not easily available from IDML
          style: styleName
        });
      }
    }
  }
  
  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  
  return { bookId, items };
}

function findParagraphs(obj: any): any[] {
  const results: any[] = [];
  
  if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...findParagraphs(item));
    }
  } else if (obj && typeof obj === 'object') {
    if (obj.ParagraphStyleRange) {
      const ranges = Array.isArray(obj.ParagraphStyleRange) ? obj.ParagraphStyleRange : [obj.ParagraphStyleRange];
      results.push(...ranges);
    }
    for (const key of Object.keys(obj)) {
      results.push(...findParagraphs(obj[key]));
    }
  }
  
  return results;
}

function extractText(obj: any): string {
  let text = '';
  
  if (typeof obj === 'string') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    for (const item of obj) {
      text += extractText(item);
    }
  } else if (obj && typeof obj === 'object') {
    if (obj.Content) {
      text += typeof obj.Content === 'string' ? obj.Content : extractText(obj.Content);
    }
    if (obj.CharacterStyleRange) {
      const ranges = Array.isArray(obj.CharacterStyleRange) ? obj.CharacterStyleRange : [obj.CharacterStyleRange];
      for (const r of ranges) {
        text += extractText(r);
      }
    }
    if (obj['#text']) {
      text += obj['#text'];
    }
  }
  
  return text.replace(/[\r\n]+/g, ' ').trim();
}

// Main
async function main() {
  const bookId = process.argv[2];
  
  if (!bookId) {
    console.log('Available books:', Object.keys(IDML_MAP).join(', '));
    console.log('\nUsage: npx tsx extract-toc-from-idml.ts <bookId>');
    console.log('       npx tsx extract-toc-from-idml.ts all');
    process.exit(1);
  }
  
  const books = bookId === 'all' ? Object.keys(IDML_MAP) : [bookId];
  
  for (const id of books) {
    console.log(`\n=== Extracting TOC for ${id} ===`);
    try {
      const toc = await extractTocFromIdml(id);
      console.log(`Found ${toc.items.length} heading items`);
      
      // Save to file
      const outPath = path.join(process.cwd(), 'output', `${id}_toc.json`);
      fs.writeFileSync(outPath, JSON.stringify(toc, null, 2));
      console.log(`Saved to ${outPath}`);
      
      // Show preview
      for (const item of toc.items.slice(0, 10)) {
        const indent = '  '.repeat(item.level - 1);
        console.log(`${indent}${item.num} ${item.label}`);
      }
      if (toc.items.length > 10) {
        console.log(`  ... and ${toc.items.length - 10} more`);
      }
    } catch (err) {
      console.error(`Error: ${err}`);
    }
  }
}

main();



