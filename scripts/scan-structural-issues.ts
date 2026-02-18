/**
 * scan-structural-issues.ts
 *
 * Scans all chapters for deterministic structural issues:
 * 1. Unfinished sentences (ending with preposition/connector)
 * 2. Orphan list intros (ending with ':' but no list follows)
 * 3. Broken bullet punctuation (';.' or double punctuation)
 * 4. Missing 'praktijk'/'verdieping' blocks (compare original vs rewritten)
 *
 * Output:
 * - todo/issues_manifest.json (summary)
 * - todo/tasks/pending/task_chXX_sectionYY.json (individual repair tasks)
 */

import fs from 'node:fs';
import path from 'node:path';

const INPUT_DIR = 'output/json_first/MBO_AF4_2024_COMMON_CORE/20251226_035715';
const TODO_DIR = 'todo';
const PENDING_DIR = path.join(TODO_DIR, 'tasks', 'pending');

// Ensure dirs exist
if (!fs.existsSync(PENDING_DIR)) {
  fs.mkdirSync(PENDING_DIR, { recursive: true });
}

type Issue = {
  type: 'unfinished_sentence' | 'orphan_list_intro' | 'broken_punctuation' | 'missing_block';
  message: string;
  paragraph_id: string;
  section: string;
};

type Task = {
  id: string;
  chapter: string;
  section: string;
  issues: Issue[];
  paragraphs: any[]; // The full paragraph objects needed for context
};

function getSectionId(p: any): string {
  const ch = p.chapter;
  const pn = p.paragraph_number;
  const spn = p.subparagraph_number;
  if (spn != null) return `${ch}.${pn}.${spn}`;
  if (pn != null) return `${ch}.${pn}`;
  return `${ch}`;
}

// Need access to next paragraph to verify list continuity
function scanParagraph(p: any, nextP: any | null): Issue[] {
  const issues: Issue[] = [];
  const txt = String(p.rewritten || '').trim();
  const orig = String(p.original || '').trim();
  const pid = p.paragraph_id;
  const section = getSectionId(p);

  // 1. Unfinished sentences
  if (/\b(de|het|een|van|voor|met|door|op|in|aan|of|en)\s*[.?!]?\s*$/i.test(txt)) {
    issues.push({
      type: 'unfinished_sentence',
      message: 'Zin eindigt abrupt op een voorzetsel, lidwoord of voegwoord.',
      paragraph_id: pid,
      section
    });
  }

  // 2. Orphan list intros
  // Ends with ':' but next paragraph is NOT a list item
  if (txt.endsWith(':')) {
    const nextStyle = String(nextP?.style_name || '').toLowerCase();
    const isNextList = nextStyle.includes('bullet') || nextStyle.includes('numbered') || nextStyle.includes('opsomming');
    
    // Also check if next paragraph text looks like a list item (starts with marker)
    const nextTxt = String(nextP?.rewritten || '').trim();
    const looksLikeList = /^[•\-\d]+\.?\s/.test(nextTxt);

    if (!isNextList && !looksLikeList) {
      issues.push({
        type: 'orphan_list_intro',
        message: 'Eindigt op dubbele punt maar wordt niet gevolgd door lijst-items.',
        paragraph_id: pid,
        section
      });
    }
  }

  // 3. Broken punctuation
  if (/[;.]{2,}/.test(txt) && !txt.includes('...')) {
     issues.push({
      type: 'broken_punctuation',
      message: 'Bevat dubbele interpunctie (bijv. ;.)',
      paragraph_id: pid,
      section
    });
  }

  // 4. Missing blocks (Praktijk / Verdieping)
  // Check markers in original vs rewritten
  const markers = ['<<BOLD_START>>In de praktijk', '<<BOLD_START>>Verdieping'];
  for (const m of markers) {
    if (orig.includes(m) && !txt.includes(m)) {
      issues.push({
        type: 'missing_block',
        message: `Mist verplicht blok: ${m}`,
        paragraph_id: pid,
        section
      });
    }
  }

  return issues;
}

async function main() {
  console.log('🔍 Scanning chapters for structural issues...');
  
  // Find all iterated JSONs (or input if we want to scan raw input, but we want to scan LATEST output)
  // We use the "SINGLE_PASS_POC" output for ch01 if available, otherwise fall back to iterated
  // Actually, let's scan the BEST available version for each chapter.
  // For now, let's scan the standard "iterated" output from the last run.
  
  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => f.startsWith('ch') && f.endsWith('.iterated.json'))
    .map(f => path.join(INPUT_DIR, f));

  const allIssues: Issue[] = [];
  let tasksCreated = 0;

  for (const file of files) {
    const chNum = path.basename(file).match(/ch(\d+)/)?.[1] || '00';
    console.log(`   Scanning chapter ${chNum}...`);
    
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const paragraphs = data.paragraphs || [];
      
      // Group by section to create coherent tasks
      const sectionMap = new Map<string, { issues: Issue[], paras: any[] }>();

      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        const nextP = paragraphs[i + 1] || null;
        
        const issues = scanParagraph(p, nextP);
        if (issues.length > 0) {
          allIssues.push(...issues);
          
          const sec = getSectionId(p);
          if (!sectionMap.has(sec)) {
            // Get all paras for this section for context
            const secParas = paragraphs.filter((x: any) => getSectionId(x) === sec);
            sectionMap.set(sec, { issues: [], paras: secParas });
          }
          sectionMap.get(sec)!.issues.push(...issues);
        }
      }

      // Create tasks
      for (const [section, data] of sectionMap) {
        const task: Task = {
          id: `task_ch${chNum}_sec${section.replace(/\./g, '_')}`,
          chapter: chNum,
          section: section,
          issues: data.issues,
          paragraphs: data.paras
        };

        const taskPath = path.join(PENDING_DIR, `${task.id}.json`);
        fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
        tasksCreated++;
      }

    } catch (e: any) {
      console.error(`   ❌ Error reading ${file}: ${e.message}`);
    }
  }

  // Write manifest
  const manifest = {
    total_issues: allIssues.length,
    tasks_created: tasksCreated,
    timestamp: new Date().toISOString(),
    issue_counts: {
      unfinished_sentence: allIssues.filter(i => i.type === 'unfinished_sentence').length,
      orphan_list_intro: allIssues.filter(i => i.type === 'orphan_list_intro').length,
      broken_punctuation: allIssues.filter(i => i.type === 'broken_punctuation').length,
      missing_block: allIssues.filter(i => i.type === 'missing_block').length,
    }
  };

  fs.writeFileSync(path.join(TODO_DIR, 'issues_manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('\n📊 SCAN COMPLETE');
  console.log(`   Total issues found: ${manifest.total_issues}`);
  console.log(`   Repair tasks created: ${manifest.tasks_created}`);
  console.log('   Breakdown:', JSON.stringify(manifest.issue_counts, null, 2));
  console.log(`   Manifest saved to: ${path.join(TODO_DIR, 'issues_manifest.json')}`);
  console.log(`   Tasks queued in: ${PENDING_DIR}`);
}

main();

