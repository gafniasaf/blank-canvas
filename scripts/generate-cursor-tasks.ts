/**
 * generate-cursor-tasks.ts
 *
 * Generates Cursor-ready micro-fix tasks from lint report.
 * Each task is a focused instruction for a Cursor agent to fix ONE issue.
 *
 * Usage:
 *   npx ts-node scripts/generate-cursor-tasks.ts <lint-report.json> <source.json> [--errors-only] [--output-dir todo/cursor-tasks]
 */

import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// TYPES
// ============================================================================

interface LintIssue {
  rule: string;
  severity: 'error' | 'warning';
  paragraph_id: string;
  section: string;
  message: string;
  evidence: string;
}

interface LintReport {
  input_file: string;
  issues: LintIssue[];
}

interface Paragraph {
  paragraph_id?: string;
  chapter?: string;
  paragraph_number?: number;
  subparagraph_number?: number;
  style_name?: string;
  original?: string;
  rewritten?: string;
}

interface CursorTask {
  id: string;
  rule: string;
  severity: string;
  paragraph_id: string;
  section: string;
  
  // Context for the agent
  instruction: string;
  constraints: string[];
  
  // The actual content
  paragraph: Paragraph;
  prev_paragraph?: Paragraph;
  next_paragraph?: Paragraph;
  
  // Evidence
  lint_message: string;
  lint_evidence: string;
}

// ============================================================================
// RULE-SPECIFIC INSTRUCTIONS
// ============================================================================

const RULE_INSTRUCTIONS: Record<string, { instruction: string; constraints: string[] }> = {
  UNFINISHED_SENTENCE: {
    instruction: 'De zin eindigt abrupt op een voorzetsel of lidwoord. Maak de zin af of herformuleer zodat hij grammaticaal correct eindigt.',
    constraints: [
      'Voeg maximaal 2-5 woorden toe om de zin af te maken.',
      'Verander de betekenis niet.',
      'Als de zin al correct is (bijv. "tegen elkaar aan" als werkwoord), markeer dan als FALSE_POSITIVE.',
    ],
  },
  BROKEN_PUNCTUATION: {
    instruction: 'De tekst bevat dubbele of kapotte interpunctie (bijv. ";." of ",."). Corrigeer dit.',
    constraints: [
      'Verwijder of corrigeer alleen de kapotte interpunctie.',
      'Verander verder niets aan de tekst.',
    ],
  },
  COLON_WITHOUT_LIST: {
    instruction: 'De paragraaf eindigt op ":" maar wordt niet gevolgd door een lijst. Pas aan.',
    constraints: [
      'Optie A: Verwijder de dubbele punt en maak er een normale zin van.',
      'Optie B: Voeg de lijst toe die ontbreekt (alleen als die in de originele tekst stond).',
      'Kies de optie die het beste past bij de context.',
    ],
  },
  LIST_INTRO_NO_FOLLOWUP: {
    instruction: 'De zin eindigt op een lijst-intro woord (zoals, bijvoorbeeld) maar wordt niet gevolgd door een opsomming.',
    constraints: [
      'Herformuleer de zin zodat hij geen belofte maakt die niet wordt ingelost.',
      'Of: voeg de ontbrekende voorbeelden toe als die in het origineel stonden.',
    ],
  },
  PRAKTIJK_MARKER_MALFORMED: {
    instruction: 'De Praktijk-marker is verkeerd geformatteerd. Corrigeer naar: <<BOLD_START>>In de praktijk:<<BOLD_END>>',
    constraints: [
      'Verander alleen de marker, niet de inhoud.',
      'Zorg dat de dubbele punt erna komt, niet ervoor.',
    ],
  },
  VERDIEPING_MARKER_MALFORMED: {
    instruction: 'De Verdieping-marker is verkeerd geformatteerd. Corrigeer naar: <<BOLD_START>>Verdieping:<<BOLD_END>>',
    constraints: [
      'Verander alleen de marker, niet de inhoud.',
    ],
  },
  MULTI_SENTENCE_BULLET: {
    instruction: 'Deze bullet bevat meerdere zinnen. Overweeg opsplitsen of omzetten naar lopende tekst.',
    constraints: [
      'Als de informatie beter als lopende tekst werkt, herschrijf dan als normale paragraaf.',
      'Als het echt een lijst moet zijn, splits dan in meerdere korte bullets.',
      'Behoud alle informatie.',
    ],
  },
  ORPHAN_CONTINUATION: {
    instruction: 'Deze korte alinea lijkt grammaticaal af te hangen van de vorige. Controleer of dit correct is.',
    constraints: [
      'Als het een fragment is: voeg samen met de vorige paragraaf.',
      'Als het een zelfstandige zin is: markeer als FALSE_POSITIVE.',
    ],
  },
  SENTENCE_TOO_LONG: {
    instruction: 'Deze zin is te lang voor N3 niveau (>30 woorden). Splits in kortere zinnen.',
    constraints: [
      'Splits in 2-3 kortere zinnen.',
      'Behoud alle informatie.',
      'Gebruik simpele verbindingswoorden.',
    ],
  },
  FORBIDDEN_OPENER: {
    instruction: 'De tekst bevat een verboden opener/filler woord. Verwijder of herformuleer.',
    constraints: [
      'Verwijder woorden als "eigenlijk", "in principe", "uiteraard".',
      'Maak de zin direct en concreet.',
    ],
  },
  HARD_LINEBREAK_IN_PARA: {
    instruction: 'De paragraaf bevat harde regeleindes. Verwijder deze of splits in aparte paragrafen.',
    constraints: [
      'Vervang \\n door een spatie, of',
      'Maak er aparte paragrafen van als dat logischer is.',
    ],
  },
};

// ============================================================================
// MAIN
// ============================================================================

function main() {
  const args = process.argv.slice(2);
  const reportPath = args.find(a => !a.startsWith('--') && a.includes('lint-report')) || '';
  const sourcePath = args.find(a => !a.startsWith('--') && !a.includes('lint-report')) || '';
  const errorsOnly = args.includes('--errors-only');
  
  const getArg = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
  };
  const outputDir = getArg('--output-dir') || 'todo/cursor-tasks';

  if (!reportPath || !sourcePath) {
    console.error('Usage: npx ts-node scripts/generate-cursor-tasks.ts <lint-report.json> <source.json> [--errors-only] [--output-dir DIR]');
    process.exit(1);
  }

  // Load data
  const report: LintReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
  const paragraphs: Paragraph[] = source.paragraphs || [];

  // Build paragraph lookup
  const paraById = new Map<string, { para: Paragraph; index: number }>();
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]!;
    if (p.paragraph_id) {
      paraById.set(p.paragraph_id, { para: p, index: i });
    }
  }

  // Filter issues
  let issues = report.issues;
  if (errorsOnly) {
    issues = issues.filter(i => i.severity === 'error');
  }

  // Create output dir
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate tasks
  const tasks: CursorTask[] = [];
  
  for (const issue of issues) {
    const lookup = paraById.get(issue.paragraph_id);
    if (!lookup) continue;

    const { para, index } = lookup;
    const prevPara = index > 0 ? paragraphs[index - 1] : undefined;
    const nextPara = index < paragraphs.length - 1 ? paragraphs[index + 1] : undefined;

    const ruleInfo = RULE_INSTRUCTIONS[issue.rule] || {
      instruction: issue.message,
      constraints: ['Fix het probleem zonder de betekenis te veranderen.'],
    };

    const task: CursorTask = {
      id: `task_${issue.rule}_${issue.paragraph_id.slice(0, 8)}`,
      rule: issue.rule,
      severity: issue.severity,
      paragraph_id: issue.paragraph_id,
      section: issue.section,
      instruction: ruleInfo.instruction,
      constraints: ruleInfo.constraints,
      paragraph: para,
      prev_paragraph: prevPara,
      next_paragraph: nextPara,
      lint_message: issue.message,
      lint_evidence: issue.evidence,
    };

    tasks.push(task);

    // Save individual task file
    const taskPath = path.join(outputDir, `${task.id}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
  }

  // Save summary
  const summaryPath = path.join(outputDir, '_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    total_tasks: tasks.length,
    errors_only: errorsOnly,
    by_rule: tasks.reduce((acc, t) => {
      acc[t.rule] = (acc[t.rule] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    task_ids: tasks.map(t => t.id),
  }, null, 2));

  console.log(`\n✅ Generated ${tasks.length} Cursor tasks`);
  console.log(`   Output dir: ${outputDir}`);
  console.log(`   Errors only: ${errorsOnly}`);
  console.log('');
  console.log('By rule:');
  const byRule = tasks.reduce((acc, t) => {
    acc[t.rule] = (acc[t.rule] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rule}: ${count}`);
  }

  // Show sample task
  if (tasks.length > 0) {
    console.log('\n─'.repeat(60));
    console.log('SAMPLE TASK:');
    console.log('─'.repeat(60));
    const sample = tasks[0]!;
    console.log(`ID: ${sample.id}`);
    console.log(`Rule: ${sample.rule}`);
    console.log(`Section: ${sample.section}`);
    console.log(`\nInstruction: ${sample.instruction}`);
    console.log(`\nConstraints:`);
    for (const c of sample.constraints) {
      console.log(`  - ${c}`);
    }
    console.log(`\nCurrent text:`);
    console.log(`  "${(sample.paragraph.rewritten || '').slice(0, 200)}..."`);
  }
}

main();































