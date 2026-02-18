/**
 * apply-cursor-fix.ts
 *
 * Applies a fix from a Cursor agent to the source JSON.
 * The agent provides a patched paragraph, this script applies it.
 *
 * Usage:
 *   npx ts-node scripts/apply-cursor-fix.ts <source.json> <task-id> <fixed-text>
 *   
 * Or in batch mode:
 *   npx ts-node scripts/apply-cursor-fix.ts <source.json> --batch <fixes.json>
 *
 * The script:
 * 1. Loads the source JSON
 * 2. Finds the paragraph by ID
 * 3. Updates the rewritten text
 * 4. Saves the updated JSON
 * 5. Moves the task to "done"
 */

import fs from 'node:fs';
import path from 'node:path';

interface Fix {
  task_id: string;
  paragraph_id: string;
  fixed_text: string;
  status: 'fixed' | 'false_positive' | 'skipped';
  notes?: string;
}

interface Paragraph {
  paragraph_id?: string;
  rewritten?: string;
  [key: string]: any;
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage:');
    console.error('  Single: npx ts-node scripts/apply-cursor-fix.ts <source.json> <task-id> <fixed-text>');
    console.error('  Batch:  npx ts-node scripts/apply-cursor-fix.ts <source.json> --batch <fixes.json>');
    process.exit(1);
  }

  const sourcePath = args[0]!;
  const isBatch = args[1] === '--batch';

  // Load source
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
  const paragraphs: Paragraph[] = source.paragraphs || [];

  // Build lookup
  const paraIndex = new Map<string, number>();
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]!;
    if (p.paragraph_id) {
      paraIndex.set(p.paragraph_id, i);
    }
  }

  let fixes: Fix[] = [];

  if (isBatch) {
    // Batch mode
    const fixesPath = args[2];
    if (!fixesPath) {
      console.error('Batch mode requires fixes.json path');
      process.exit(1);
    }
    fixes = JSON.parse(fs.readFileSync(fixesPath, 'utf-8'));
  } else {
    // Single fix mode - load from task file
    const taskId = args[1]!;
    const fixedText = args.slice(2).join(' ');
    
    // Find task file
    const taskDirs = ['todo/cursor-tasks-ch06', 'todo/cursor-tasks'];
    let taskFile = '';
    for (const dir of taskDirs) {
      const candidate = path.join(dir, `${taskId}.json`);
      if (fs.existsSync(candidate)) {
        taskFile = candidate;
        break;
      }
    }
    
    if (!taskFile) {
      console.error(`Task not found: ${taskId}`);
      process.exit(1);
    }
    
    const task = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
    fixes = [{
      task_id: taskId,
      paragraph_id: task.paragraph_id,
      fixed_text: fixedText || task.paragraph.rewritten, // Use original if no fix provided
      status: fixedText ? 'fixed' : 'skipped',
    }];
  }

  // Apply fixes
  let applied = 0;
  let skipped = 0;
  let falsePositives = 0;

  for (const fix of fixes) {
    if (fix.status === 'skipped') {
      skipped++;
      continue;
    }
    
    if (fix.status === 'false_positive') {
      falsePositives++;
      // Move task to done with note
      continue;
    }

    const idx = paraIndex.get(fix.paragraph_id);
    if (idx === undefined) {
      console.warn(`Paragraph not found: ${fix.paragraph_id}`);
      continue;
    }

    paragraphs[idx]!.rewritten = fix.fixed_text;
    applied++;
    console.log(`✅ Applied fix: ${fix.task_id}`);
  }

  // Save updated source
  fs.writeFileSync(sourcePath, JSON.stringify(source, null, 2));

  console.log(`\n📊 Summary:`);
  console.log(`   Applied: ${applied}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   False positives: ${falsePositives}`);
  console.log(`   Updated: ${sourcePath}`);
}

main();































